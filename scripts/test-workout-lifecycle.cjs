// Disposable PostgreSQL verification. No production credentials or data.
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const roots = [process.env.PGLITE_ROOT || path.resolve(__dirname, '..')];

async function database() {
  const url = process.env.PT_LIFECYCLE_DB_URL;
  if (!url) {
    const { PGlite } = require(require.resolve('@electric-sql/pglite', { paths: roots }));
    const db = new PGlite();
    return { db, connect: null, close: () => db.close() };
  }
  assert(['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname), 'test database must be local');
  const { Client } = require(require.resolve('pg', { paths: roots }));
  const admin = new Client({ connectionString: url });
  await admin.connect();
  const name = 'pt_lifecycle_' + randomUUID().replaceAll('-', '');
  await admin.query(`create database ${name}`);
  const connections = [];
  const connect = async () => {
    const dbUrl = new URL(url); dbUrl.pathname = '/' + name;
    const client = new Client({ connectionString: dbUrl.toString() });
    await client.connect(); connections.push(client);
    client.exec = sql => client.query(sql);
    return client;
  };
  const db = await connect();
  return { db, connect, close: async () => {
    for (const connection of connections) await connection.end();
    await admin.query(`drop database ${name}`); await admin.end();
  } };
}

(async () => {
  const env = await database(), db = env.db;
  try {
    await db.exec(`create schema auth; create schema storage;
      do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end$$;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table storage.buckets(id text primary key,name text,public boolean);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
    const dir = path.join(__dirname, '../supabase/migrations');
    for (const file of readdirSync(dir).filter(file => file.endsWith('.sql')).sort()) {
      if (process.env.SKIP_START_SESSION_FIX && file.endsWith('_idempotent_session_start.sql')) continue;
      await db.exec(readFileSync(path.join(dir, file), 'utf8'));
    }
    assert.notEqual((await db.query("select to_regprocedure('public.start_session(uuid,uuid,timestamptz,date,text)') as rpc")).rows[0].rpc,
      null, 'start_session RPC must exist before a persisted start can replay');
    await db.exec('grant usage on schema public,auth to anon,authenticated; grant select,insert,update,delete on public.profiles,public.plans,public.plan_days,public.plan_blocks,public.plan_items,public.sessions to anon,authenticated');
    const fixture = async () => {
      const f = Object.fromEntries(['owner','plan','day','otherDay'].map(key => [key, randomUUID()]));
      await db.query('insert into auth.users values($1)', [f.owner]);
      await db.query("insert into plans(id,user_id,name,split) values($1,$2,'Fixture','Full')", [f.plan, f.owner]);
      await db.query("insert into plan_days(id,plan_id,day_index,name,focus) values($1,$2,0,'Day','Strength'),($3,$2,1,'Other','Strength')", [f.day, f.plan, f.otherDay]);
      return f;
    };
    const a = await fixture(), b = await fixture();
    const as = async (client, owner = a.owner, role = 'authenticated') => {
      await client.exec('reset role');
      await client.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
      await client.exec(`set role ${role}`);
    };
    const captured = { id: randomUUID(), day: a.day, at: '2026-10-22T10:00:00.000Z', localDay: '2026-10-22', tz: 'America/Los_Angeles' };
    const call = async (client = db, start = captured) => (await client.query(
      'select public.start_session($1,$2,$3,$4,$5) as id', [start.id, start.day, start.at, start.localDay, start.tz])).rows[0].id;
    const snapshot = async id => (await db.query('select to_jsonb(s) as row from sessions s where id=$1', [id])).rows[0]?.row;

    await as(db);
    // Discard the first response, as if the connection dropped after commit.
    await call();
    const initial = await snapshot(captured.id);
    assert.equal(await call(), captured.id, 'lost-response retry must return the original UUID');
    assert.deepEqual(await snapshot(captured.id), initial, 'replay must not rewrite the session');
    assert.equal((await db.query('select count(*)::int as n from sessions where id=$1', [captured.id])).rows[0].n, 1);
    assert.equal(initial.user_id, a.owner);
    assert.equal(Date.parse(initial.started_at), Date.parse(captured.at));
    assert.equal(initial.local_day, captured.localDay);
    assert.equal(initial.tz, captured.tz);
    assert.equal(await call(db, { ...captured, at: '2026-10-22T03:00:00-07:00' }), captured.id, 'equivalent timestamp offsets represent the same instant');

    for (const mismatch of [
      { day: a.otherDay }, { at: '2026-10-22T10:01:00Z' }, { tz: 'UTC' },
    ]) await assert.rejects(call(db, { ...captured, ...mismatch }), { code: 'PT409' });
    await assert.rejects(call(db, { ...captured, localDay: '2026-10-21' }), { code: '22023' });
    assert.deepEqual(await snapshot(captured.id), initial, 'mismatched retries must preserve original data');
    await db.query("update sessions set completed_at='2026-10-22T11:00:00Z',duration_s=3600,notes='Retained' where id=$1", [captured.id]);
    const completed = await snapshot(captured.id);
    assert.equal(await call(), captured.id, 'a late start retry must acknowledge an already completed session');
    assert.deepEqual(await snapshot(captured.id), completed);

    const invalid = [
      { id: null }, { day: null }, { at: null }, { at: 'infinity' },
      { localDay: null }, { localDay: 'infinity' }, { tz: null }, { tz: '' },
      { tz: 'unknown/timezone' }, { localDay: '2026-10-21' },
    ];
    for (const patch of invalid) await assert.rejects(call(db, { ...captured, id: randomUUID(), ...patch }), { code: '22023' });
    for (const day of [b.day, randomUUID()]) await assert.rejects(call(db, { ...captured, id: randomUUID(), day }), { code: '42501' });
    await as(db, b.owner);
    await assert.rejects(call(db, { ...captured, day: b.day }), { code: '42501' });
    await as(db, '', 'anon');
    await assert.rejects(call(), { code: '42501' });
    await as(db, '', 'authenticated');
    await assert.rejects(call(), { code: '42501' });

    await db.exec('reset role');
    await db.query('update plans set is_active=false where id=$1', [a.plan]);
    await as(db);
    const delayed = { ...captured, id: randomUUID() };
    assert.equal(await call(db, delayed), delayed.id, 'a cached owned day remains valid after its plan is retired');
    assert.equal((await db.query('select count(*)::int as n from sessions')).rows[0].n, 2, 'invalid calls must not insert rows');

    if (env.connect) {
      const first = await env.connect(), second = await env.connect();
      await as(first); await as(second);
      const simultaneous = { ...captured, id: randomUUID() };
      await first.exec('begin');
      assert.equal(await call(first, simultaneous), simultaneous.id);
      const replay = call(second, simultaneous);
      await first.exec('commit');
      assert.equal(await replay, simultaneous.id);
      assert.equal((await db.query('select count(*)::int as n from sessions where id=$1', [simultaneous.id])).rows[0].n, 1);
      console.log('PASS concurrent duplicate starts against local PostgreSQL.');
    }
    console.log('PASS session start ownership, anonymous denial, captured context, lost-response replay, mismatched retries, completed sessions and retired plans.');
    if (!env.connect) console.log('PGlite mode. Multi-connection verification is available with PT_LIFECYCLE_DB_URL pointing to local PostgreSQL.');
  } finally { await env.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
