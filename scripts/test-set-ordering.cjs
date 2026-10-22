// Disposable PostgreSQL verification. No production credentials or data.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const roots = [process.env.PGLITE_ROOT || path.resolve(__dirname, '..')];
const payload = (item, reps = 8) => ({ plan_item_id: item, exercise_id: 'press', set_index: 1,
  reps, weight_kg: 60, is_bodyweight: false, added_load_kg: 0, rpe: null });

async function database() {
  const url = process.env.PT_ORDERING_DB_URL;
  if (!url) {
    const { PGlite } = require(require.resolve('@electric-sql/pglite', { paths: roots }));
    const db = new PGlite();
    return { db, real: false, connect: null, close: () => db.close() };
  }
  assert(['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname), 'test database must be local');
  const { Client } = require(require.resolve('pg', { paths: roots }));
  const admin = new Client({ connectionString: url }); await admin.connect();
  const name = 'pt_ordering_' + randomUUID().replaceAll('-', '');
  await admin.query(`create database ${name}`);
  const connections = [];
  const connect = async (applicationName) => {
    const dbUrl = new URL(url); dbUrl.pathname = '/' + name;
    const client = new Client({ connectionString: dbUrl.toString(), application_name: applicationName });
    await client.connect(); connections.push(client);
    client.exec = (sql) => client.query(sql);
    return client;
  };
  const db = await connect('pt-ordering-admin');
  return { db, real: true, connect, close: async () => {
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
    const migrate = (name) => db.exec(readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8'));
    await migrate('0001_init.sql'); await migrate('0002_profile_identity.sql');
    await db.exec('grant usage on schema public,auth to anon,authenticated; grant select,insert,update,delete on all tables in schema public to anon,authenticated');
    const fixture = async () => {
      const f = Object.fromEntries(['owner','plan','day','block','item','legacy'].map((key) => [key,randomUUID()]));
      await db.query('insert into auth.users values($1)',[f.owner]);
      await db.query("insert into plans(id,user_id,name,split) values($1,$2,'Fixture','Fixture')",[f.plan,f.owner]);
      await db.query("insert into plan_days(id,plan_id,day_index,name,focus) values($1,$2,0,'Day','Strength')",[f.day,f.plan]);
      await db.query("insert into plan_blocks(id,plan_day_id,block_index,kind,title) values($1,$2,0,'straight','Work')",[f.block,f.day]);
      await db.query("insert into plan_items(id,block_id,item_index,exercise_id) values($1,$2,0,'press')",[f.item,f.block]);
      await db.query("insert into sessions(id,user_id,plan_day_id,completed_at) values($1,$2,$3,'2026-10-01')",[f.legacy,f.owner,f.day]);
      await db.query("insert into set_logs(session_id,plan_item_id,exercise_id,set_index,reps,weight_kg,completed_at) values($1,$2,'press',1,8,60,'2026-10-01T12:00:00Z')",[f.legacy,f.item]);
      return f;
    };
    const a = await fixture(), b = await fixture();
    const historical = (await db.query('select to_jsonb(l) as data from set_logs l order by id')).rows;
    await migrate('0003_correctness_foundation.sql'); await migrate('0004_save_plan_rpc.sql');
    await migrate('0005_session_progress_rpc.sql'); await migrate('0006_workout_reference_ownership.sql');
    const fresh = async (owner=a) => {
      await db.exec('reset role'); const id = randomUUID();
      await db.query('insert into sessions(id,user_id,plan_day_id,local_day) values($1,$2,$3,current_date)',[id,owner.owner,owner.day]);
      return id;
    };
    const as = async (client, owner=a.owner) => {
      await client.exec('reset role');
      await client.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
      await client.exec('set role authenticated');
    };
    if (process.env.SKIP_SET_ORDERING_FIX) {
      const session = await fresh(); await as(db);
      for (const reps of [12,8]) await db.query(`insert into set_logs(session_id,plan_item_id,exercise_id,set_index,reps,weight_kg)
        values($1,$2,'press',1,$3,60) on conflict(session_id,plan_item_id,set_index) do update set reps=excluded.reps`,[session,a.item,reps]);
      assert.equal((await db.query('select reps from set_logs where session_id=$1',[session])).rows[0].reps,12,'late old request overwrote the correction');
      return;
    }
    await migrate('0007_ordered_set_writes.sql');
    assert.deepEqual((await db.query('select to_jsonb(l) as data from set_logs l order by id')).rows,historical,'historical sets/times must not change');
    const event = '2026-10-06T09:00:00Z', origin = randomUUID(), otherOrigin = randomUUID();
    const call = async (client, session, set, writer=origin, revision=1, version=0, at=event) => (await client.query(
      'select public.log_set_versioned($1,$2::jsonb,$3,$4,$5,$6) as result', [session,JSON.stringify(set),writer,revision,version,at])).rows[0].result;
    const state = async (client, session, item=a.item) => (await client.query('select public.get_set_write_state($1,$2,1) as result',[session,item])).rows[0].result;
    const legacy = async (session,set) => (await db.query('select public.check_legacy_set($1,$2::jsonb) as result',[session,JSON.stringify(set)])).rows[0].result;
    const session = await fresh(); await as(db);
    assert.equal((await call(db,session,payload(a.item,12),origin,2)).status,'applied');
    assert.equal((await call(db,session,payload(a.item,8),origin,1)).status,'superseded');
    assert.equal((await state(db,session)).set.reps,12);
    assert.equal((await call(db,session,payload(a.item,12),origin,2)).status,'duplicate');
    await assert.rejects(call(db,session,payload(a.item,9),origin,2),{code:'22023'});
    await assert.rejects(call(db,session,payload(a.item,12),origin,2,0,'2026-10-06T09:01:00Z'),{code:'22023'});
    assert.equal((await call(db,session,payload(a.item,8),origin,3)).serverVersion,2);
    await assert.rejects(call(db,session,payload(a.item,10),otherOrigin,1,0),{code:'PT409'});
    assert.equal((await call(db,session,payload(a.item,10),otherOrigin,1,2)).serverVersion,3);
    await assert.rejects(call(db,session,payload(a.item,11),origin,4,2),{code:'PT409'});
    assert.equal((await call(db,session,payload(a.item,12),origin,2)).status,'superseded');
    assert.equal((await call(db,session,payload(a.item,11),origin,4,3)).serverVersion,4);
    assert.equal((await call(db,session,payload(a.item,8),origin,3)).status,'superseded');
    assert.equal((await state(db,session)).set.reps,11);
    assert.equal(Date.parse((await state(db,session)).eventAt),Date.parse(event));
    await assert.rejects(db.query('update set_logs set reps=1 where session_id=$1',[session]),{code:'42501'});
    await assert.rejects(db.query('delete from set_logs where session_id=$1',[session]),{code:'42501'});
    await assert.rejects(db.query("insert into set_logs(session_id,plan_item_id,exercise_id,set_index) values($1,$2,'press',2)",[session,a.item]),{code:'42501'});
    await assert.rejects(db.query('select * from set_write_versions'),{code:'42501'});
    await assert.rejects(call(db,session,payload(b.item),origin,5),{code:'42501'});
    await assert.rejects(call(db,session,{...payload(a.item),exercise_id:'wrong'},origin,5),{code:'42501'});
    await assert.rejects(call(db,session,payload(a.item),origin,9007199254740992),{code:'22023'});
    await assert.rejects(call(db,session,{...payload(a.item),weight_kg:'60'},origin,5),{code:'22023'});
    await assert.rejects(call(db,session,payload(a.item),origin,5,0,'infinity'),{code:'22023'});
    await as(db,b.owner);
    await assert.rejects(state(db,session),{code:'42501'});
    await assert.rejects(call(db,session,payload(a.item),otherOrigin,2,4),{code:'42501'});
    await as(db);
    assert.equal((await legacy(a.legacy,payload(a.item))).status,'duplicate');
    assert.equal((await legacy(a.legacy,payload(a.item,12))).status,'conflict');
    const absent = await fresh(); await as(db);
    assert.equal((await legacy(absent,payload(a.item))).status,'conflict');
    await db.exec('reset role');
    await db.query("insert into session_progress_results(session_id,user_id,result) values($1,$2,'[]'::jsonb)",[session,a.owner]);
    await as(db);
    assert.equal((await call(db,session,payload(a.item,11),origin,4,3)).status,'duplicate');
    await assert.rejects(call(db,session,payload(a.item,13),origin,5,4),{code:'PT410'});

    const snapshot = async (client,s) => (await client.query('select get_session_set_snapshot($1) as result',[s])).rows[0].result;
    const receipt = async (client,s,versions) => client.query("select apply_session_progress($1,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,$2::jsonb)",[s,JSON.stringify(versions)]);
    const stale=await fresh(); await as(db);
    await call(db,stale,payload(a.item),origin,1);
    const before=await snapshot(db,stale);
    assert.equal(before.logs[0].reps,8);
    await db.exec('reset role'); await db.query('update sessions set completed_at=now() where id=$1',[stale]); await as(db);
    await call(db,stale,payload(a.item,12),origin,2);
    await assert.rejects(receipt(db,stale,before.versions),{code:'40001'});
    assert.equal((await db.query('select count(*)::int as count from session_progress_results where session_id=$1',[stale])).rows[0].count,0);
    const after=await snapshot(db,stale);
    await assert.rejects(receipt(db,stale,[]),{code:'40001'});
    await assert.rejects(receipt(db,stale,[...after.versions,...after.versions]),{code:'22023'});
    await assert.rejects(receipt(db,stale,[{...after.versions[0],serverVersion:1.5}]),{code:'22023'});
    await assert.rejects(db.query("select apply_session_progress($1,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb)",[stale]),{code:'42501'});
    assert.equal((await db.query('select count(*)::int as count from exercise_progress where user_id=$1',[a.owner])).rows[0].count,0,'stale finalization must not change progression');
    await call(db,stale,{...payload(a.item),set_index:2},origin,1);
    await assert.rejects(receipt(db,stale,after.versions),{code:'40001'}); // A newly added set changes membership.
    const complete=await snapshot(db,stale);
    await receipt(db,stale,complete.versions);
    await receipt(db,stale,before.versions); // An existing receipt remains idempotent.
    await as(db,b.owner); await assert.rejects(snapshot(db,stale),{code:'42501'}); await as(db);

    if (env.real) {
      await db.exec('reset role');
      const first = await env.connect('pt-ordering-first'), second = await env.connect('pt-ordering-second');
      await as(first); await as(second);
      const waitForLock = async (pending) => {
        for (let attempt=0;attempt<100;attempt++) {
          const row=(await db.query('select wait_event_type from pg_stat_activity where pid=$1',[second.processID])).rows[0];
          if(row?.wait_event_type==='Lock') return;
          if(pending.done) throw new Error('second request finished before the transaction lock');
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        throw new Error('second connection did not block on the lock');
      };
      for (const highFirst of [true,false]) {
        const s=await fresh(); const writer=randomUUID();
        await first.exec('begin');
        await call(first,s,payload(a.item,highFirst?12:8),writer,highFirst?2:1);
        const pending={done:false};
        const next=call(second,s,payload(a.item,highFirst?8:12),writer,highFirst?1:2).finally(()=>{pending.done=true;});
        await waitForLock(pending); await first.exec('commit'); await next;
        assert.equal((await state(first,s)).set.reps,12,'two-connection ordering must keep the correction');
      }
      const corrected=await fresh(); await as(db);
      await call(db,corrected,payload(a.item),origin,1);
      const captured=await snapshot(db,corrected);
      await db.exec('reset role'); await db.query('update sessions set completed_at=now() where id=$1',[corrected]);
      await first.exec('begin'); await call(first,corrected,payload(a.item,12),origin,2);
      const waiting={done:false};
      const finalize=receipt(second,corrected,captured.versions).then(()=>null,error=>error).finally(()=>{waiting.done=true;});
      await waitForLock(waiting); await first.exec('commit');
      assert.equal((await finalize).code,'40001','a receipt waiting behind a correction must reject the stale snapshot');
      await receipt(second,corrected,(await snapshot(first,corrected)).versions);
      const finalized=await fresh();
      await db.query('update sessions set completed_at=now() where id=$1',[finalized]);
      await first.exec('begin');
      await first.query("select apply_session_progress($1,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb)",[finalized]);
      const pending={done:false};
      const mutation=call(second,finalized,payload(a.item),randomUUID()).then(()=>null,error=>error).finally(()=>{pending.done=true;});
      await waitForLock(pending); await first.exec('commit');
      assert.equal((await mutation).code,'PT410','a set waiting behind receipt creation must not mutate the workout');
      console.log('PASS: separate-connection old/new write order and receipt-versus-set locks');
    } else console.log('Concurrency not verified: PGlite uses a single connection.');
    console.log('PASS: ordering, origin conflicts, replay, owner checks, historical data, legacy comparison, event time, finalized receipts, and mutation permissions');
  } finally { await env.close(); }
})().catch(error=>{ console.error(error.message); process.exitCode=1; });
