// Disposable PostgreSQL verification. No remote credentials or database writes.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create role anon; create role authenticated;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
    const migrate = name => db.exec(readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8'));
    await migrate('20260826224459_init.sql');
    await migrate('20260826224944_slim_exercise_catalog.sql');
    await migrate('20260826225022_catalog_is_client_side.sql');
    await migrate('20260826230843_lock_down_handle_new_user.sql');
    await migrate('20261006071539_session_progress_rpc.sql');
    await migrate('20261006084911_workout_reference_ownership.sql');
    await db.exec('grant usage on schema public,auth to authenticated; grant select,insert,update,delete on all tables in schema public to authenticated');
    const a = randomUUID(), b = randomUUID(), plan = randomUUID(), day = randomUUID(), historical = randomUUID();
    await db.query('insert into auth.users values ($1),($2)', [a,b]);
    await db.query("insert into plans(id,user_id,name,split) values($1,$2,'Test','Test')", [plan,a]);
    await db.query("insert into plan_days(id,plan_id,day_index,name,focus) values($1,$2,0,'Day','Strength')", [day,plan]);
    await db.query('insert into sessions(id,user_id,plan_day_id) values($1,$2,$3)', [historical,a,day]);
    await migrate('20261022211126_session_calculation_context.sql');
    await migrate('20261007181857_account_data_export.sql');
    const as = async owner => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
      await db.exec('set role authenticated');
    };
    await as(a);
    const legacy = (await db.query('select calculation_units,bodyweight_kg,calculation_context_captured from sessions where id=$1', [historical])).rows[0];
    assert.deepEqual(legacy, { calculation_units:null, bodyweight_kg:null, calculation_context_captured:false });
    const id = randomUUID();
    await db.query("insert into sessions(id,user_id,plan_day_id,calculation_units,bodyweight_kg,calculation_context_captured) values($1,$2,$3,'lb',80,true)", [id,a,day]);
    await db.query('update sessions set duration_s=120,completed_at=now() where id=$1', [id]);
    const exported = (await db.query('select public.export_account_data() as data')).rows[0].data;
    const exportedSession = exported.sessions.find(row => row.id === id);
    assert.equal(exportedSession.calculation_units,'lb');
    assert.equal(exportedSession.bodyweight_kg,80);
    assert.equal(exportedSession.calculation_context_captured,true);
    await assert.rejects(db.query("update sessions set calculation_units='kg' where id=$1",[id]), { code:'22023' });
    await assert.rejects(db.query('update sessions set bodyweight_kg=85 where id=$1',[id]), { code:'22023' });
    await assert.rejects(db.query("update sessions set calculation_units='kg',calculation_context_captured=true where id=$1",[historical]), { code:'22023' });
    for (const weight of [-1, 'NaN', 'Infinity'])
      await assert.rejects(db.query("insert into sessions(user_id,plan_day_id,calculation_units,bodyweight_kg,calculation_context_captured) values($1,$2,'kg',$3,true)",[a,day,weight]), { code:'23514' });
    await assert.rejects(db.query('insert into sessions(user_id,plan_day_id,calculation_context_captured) values($1,$2,true)',[a,day]), { code:'23514' });
    await assert.rejects(db.query("insert into sessions(user_id,plan_day_id,calculation_units) values($1,$2,'kg')",[a,day]), { code:'23514' });
    await as(b);
    assert.equal((await db.query('select * from sessions')).rows.length,0);
    await assert.rejects(db.query("insert into sessions(user_id,plan_day_id,calculation_units,calculation_context_captured) values($1,$2,'kg',true)",[b,day]), { code:'42501' });
    console.log('PASS immutable captured context, historical unknowns, completion, numeric validation and account ownership.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
