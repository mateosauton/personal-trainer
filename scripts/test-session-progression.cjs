// Isolated PostgreSQL verification; no production credentials or network calls.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const runtime = require.resolve('@electric-sql/pglite', {
  paths: [process.env.PGLITE_ROOT || path.resolve(__dirname, '..')],
});
const { PGlite } = require(runtime);

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create role anon; create role authenticated;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
    const migrate = (name) => db.exec(readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8'));
    await migrate('0001_init.sql');
    await db.exec(`grant usage on schema public, auth to authenticated, anon;
      grant select, insert, update, delete on all tables in schema public to authenticated;`);
    const a = randomUUID(), b = randomUUID(), plan = randomUUID(), day = randomUUID();
    const block = randomUUID(), item = randomUUID(), legacy = randomUUID();
    await db.query('insert into auth.users values ($1), ($2)', [a, b]);
    await db.query("insert into plans(id,user_id,name,split) values($1,$2,'Test','Test')", [plan,a]);
    await db.query("insert into plan_days(id,plan_id,day_index,name,focus) values($1,$2,0,'Day','Strength')", [day,plan]);
    await db.query("insert into plan_blocks(id,plan_day_id,block_index,kind,title) values($1,$2,0,'straight','Work')", [block,day]);
    await db.query("insert into plan_items(id,block_id,item_index,exercise_id) values($1,$2,0,'press')", [item,block]);
    await db.query("insert into sessions(id,user_id,plan_day_id,completed_at) values($1,$2,$3,now())", [legacy,a,day]);
    // An unfinished pre-cutover workout must not overwrite a newer historical load.
    const legacyItem = randomUUID(), newerLegacy = randomUUID(), olderUnfinished = randomUUID();
    await db.query("insert into plan_items(id,block_id,item_index,exercise_id) values($1,$2,1,'legacy_press')",[legacyItem,block]);
    await db.query("insert into sessions(id,user_id,plan_day_id,started_at,completed_at) values($1,$3,$4,'2026-10-04',now()),($2,$3,$4,'2026-10-03',null)",[newerLegacy,olderUnfinished,a,day]);
    await db.query("insert into set_logs(session_id,plan_item_id,exercise_id,set_index,reps,weight_kg) values($1,$3,'legacy_press',1,8,80),($2,$3,'legacy_press',1,5,10)",[newerLegacy,olderUnfinished,legacyItem]);
    await db.query("insert into exercise_progress(user_id,exercise_id,last_weight_kg) values($1,'legacy_press',80)",[a]);
    await migrate('0005_session_progress_rpc.sql');
    await db.query('update sessions set completed_at=now() where id=$1',[olderUnfinished]);
    const session = async (started) => {
      const id = randomUUID();
      await db.query('insert into sessions(id,user_id,plan_day_id,started_at,completed_at) values($1,$2,$3,$4,now())', [id,a,day,started]);
      await db.query("insert into set_logs(session_id,plan_item_id,exercise_id,set_index,reps,weight_kg) values($1,$2,'press',1,5,60)", [id,item]);
      return id;
    };
    const first = await session('2026-10-01T00:00:00Z');
    const second = await session('2026-10-02T00:00:00Z');
    const older = await session('2026-09-30T00:00:00Z');
    const invalid = await session('2026-10-03T00:00:00Z');
    const as = async (uid, role='authenticated') => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
      await db.exec(`set role ${role}`);
    };
    const row = (weight, miss=0) => ({ exercise_id:'press', last_weight_kg:weight, last_reps:5,
      best_weight_kg:weight, best_e1rm:80, miss_streak:miss });
    const line = { exerciseId:'press', name:'Press', sets:1, volumeKg:300, topLoadKg:60, verdict:'hold', isPr:true };
    const apply = async (id, baseline, updates, result=[line]) => (await db.query(
      'select public.apply_session_progress($1,$2,$3,$4) as result',
      [id,JSON.stringify(baseline),JSON.stringify(updates),JSON.stringify(result)]
    )).rows[0].result;
    const state = async () => (await db.query("select to_jsonb(p)-'user_id'-'updated_at' as state from exercise_progress p where exercise_id='press'")).rows[0].state;
    const expected = (value) => [{ exercise_id:'press', state:value }];
    await as(a);
    assert.deepEqual(await apply(first,expected(null),[row(60,1)]),[line]);
    assert.deepEqual(await apply(first,[],[],[]),[line]);
    assert.equal((await state()).miss_streak,1, 'replay must not increment miss streak');
    await assert.rejects(apply(second,expected(null),[row(70)]), { code:'40001' });
    assert.equal((await state()).last_weight_kg,60);
    const baseline = await state();
    const replies = await Promise.all([apply(second,expected(baseline),[row(70)]),apply(second,expected(baseline),[row(70)])]);
    assert.deepEqual(replies[0],replies[1]);
    assert.equal((await state()).last_weight_kg,70);
    const oldResult = await apply(older,expected(await state()),[row(10,2)]);
    assert.equal(oldResult[0].verdict,null);
    assert.equal(oldResult[0].isPr,false);
    assert.equal((await state()).last_weight_kg,70,'old summary must not regress newer load');
    const legacyResult = await apply(legacy,[],[row(10,2)]);
    assert.equal(legacyResult[0].isPr,false);
    assert.equal((await state()).last_weight_kg,70,'historical workout must not apply again');
    await assert.rejects(apply(invalid,expected(await state()),[row(75),{...row(75),exercise_id:'zzz-unlogged'}]), { code:'42501' });
    assert.equal((await state()).last_weight_kg,70,'failed batch must roll back its earlier update');
    assert.equal((await db.query('select count(*)::int as n from session_progress_results where session_id=$1',[invalid])).rows[0].n,0);
    const lateLegacy = await apply(olderUnfinished,[],[{...row(10),exercise_id:'legacy_press'}],[{...line,exerciseId:'legacy_press'}]);
    assert.equal(lateLegacy[0].verdict,null);
    assert.equal((await db.query("select last_weight_kg from exercise_progress where exercise_id='legacy_press'")).rows[0].last_weight_kg,'80');
    await assert.rejects(db.query("update exercise_progress set miss_streak=9"), { code:'42501' });
    await assert.rejects(db.query('delete from session_progress_results'), { code:'42501' });
    await assert.rejects(db.query('insert into session_progress_results(session_id,user_id) values($1,$2)',[invalid,a]), { code:'42501' });
    await as(b);
    assert.equal((await db.query('select * from session_progress_results')).rows.length,0);
    await assert.rejects(apply(first,[],[]), { code:'42501' });
    await as('', 'anon');
    await assert.rejects(apply(first,[],[]), { code:'42501' });
    console.log('PASS progression replay, stale baseline, older summary, historical safety, rollback, owner isolation and permissions.');
    console.log('Overlapping calls were checked on one PostgreSQL connection; multi-connection concurrency remains a release check.');
  } finally { await db.close(); }
})().catch((error) => { console.error(error); process.exitCode=1; });
