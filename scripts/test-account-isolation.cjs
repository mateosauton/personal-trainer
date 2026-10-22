// Local PostgreSQL role/policy checks. Uses only disposable fixture data.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { PGlite } = require(require.resolve('@electric-sql/pglite', {
  paths: [process.env.PGLITE_ROOT || path.resolve(__dirname, '..')],
}));

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create schema storage;
      create role anon; create role authenticated;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table storage.buckets(id text primary key,name text,public boolean);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
    const migrate = (name) => db.exec(readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8'));
    await migrate('0001_init.sql'); await migrate('0002_profile_identity.sql');
    await db.exec(`grant usage on schema public, auth, storage to anon, authenticated;
      grant select, insert, update, delete on all tables in schema public to anon, authenticated;
      grant select, insert, update, delete on storage.objects to anon, authenticated;`);
    const fixture = async () => {
      const f=Object.fromEntries(['user','plan','day','block','item','session','log','avatar'].map(key=>[key,randomUUID()]));
      await db.query('insert into auth.users values($1)',[f.user]);
      await db.query("insert into plans(id,user_id,name,split) values($1,$2,'Test','Test')",[f.plan,f.user]);
      await db.query("insert into plan_days(id,plan_id,day_index,name,focus) values($1,$2,0,'Day','Strength')",[f.day,f.plan]);
      await db.query("insert into plan_blocks(id,plan_day_id,block_index,kind,title) values($1,$2,0,'straight','Work')",[f.block,f.day]);
      await db.query("insert into plan_items(id,block_id,item_index,exercise_id) values($1,$2,0,'press')",[f.item,f.block]);
      await db.query('insert into sessions(id,user_id,plan_day_id,completed_at) values($1,$2,$3,now())',[f.session,f.user,f.day]);
      await db.query("insert into set_logs(id,session_id,plan_item_id,exercise_id,set_index,reps) values($1,$2,$3,'press',1,8)",[f.log,f.session,f.item]);
      await db.query("insert into exercise_progress(user_id,exercise_id,last_weight_kg) values($1,'press',60)",[f.user]);
      await db.query("insert into storage.objects(id,bucket_id,name) values($1,'avatars',$2)",[f.avatar,f.user+'/avatar.jpg']);
      return f;
    };
    const a=await fixture(), b=await fixture();
    await migrate('0003_correctness_foundation.sql');
    await migrate('0004_save_plan_rpc.sql');
    await migrate('0005_session_progress_rpc.sql');
    if (!process.env.SKIP_WORKOUT_OWNERSHIP_FIX) await migrate('0006_workout_reference_ownership.sql');
    const as = async (user,role='authenticated') => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
      await db.exec(`set role ${role}`);
    };
    const tables=['profiles','plans','plan_days','plan_blocks','plan_items','sessions','set_logs','exercise_progress','session_progress_results'];
    for(const f of [a,b]) {
      await as(f.user);
      for(const table of tables) assert.equal((await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n,1,table+' must show only this account');
    }
    await as(a.user);
    await assert.rejects(db.query('insert into sessions(user_id,plan_day_id,local_day) values($1,$2,current_date)',[a.user,b.day]),{code:'42501'},'foreign plan day must be rejected');
    await assert.rejects(db.query('update sessions set plan_day_id=$1 where id=$2',[b.day,a.session]),{code:'42501'});
    await assert.rejects(db.query('update plan_days set plan_id=$1 where id=$2',[b.plan,a.day]),{code:'42501'});
    await assert.rejects(db.query('update plan_blocks set plan_day_id=$1 where id=$2',[b.day,a.block]),{code:'42501'});
    await assert.rejects(db.query('update plan_items set block_id=$1 where id=$2',[b.block,a.item]),{code:'42501'});
    await assert.rejects(db.query("insert into set_logs(session_id,plan_item_id,exercise_id,set_index) values($1,$2,'press',2)",[a.session,b.item]),{code:'42501'});
    await assert.rejects(db.query('update set_logs set plan_item_id=$1 where id=$2',[b.item,a.log]),{code:'42501'});
    await assert.rejects(db.query('update set_logs set session_id=$1 where id=$2',[b.session,a.log]),{code:'42501'});
    await assert.rejects(db.query("update set_logs set exercise_id='wrong-exercise' where id=$1",[a.log]),{code:'42501'});
    assert.equal((await db.query("update profiles set display_name='wrong' where id=$1 returning id",[b.user])).rows.length,0);
    assert.equal((await db.query('delete from sessions where id=$1 returning id',[b.session])).rows.length,0);
    // The owner can still create a session and upsert/correct its legitimate set.
    const own=(await db.query('insert into sessions(user_id,plan_day_id,local_day) values($1,$2,current_date) returning id',[a.user,a.day])).rows[0].id;
    await db.query("insert into set_logs(session_id,plan_item_id,exercise_id,set_index,reps) values($1,$2,'press',1,8) on conflict(session_id,plan_item_id,set_index) do update set reps=excluded.reps",[own,a.item]);
    await db.query("insert into set_logs(session_id,plan_item_id,exercise_id,set_index,reps) values($1,$2,'press',1,9) on conflict(session_id,plan_item_id,set_index) do update set reps=excluded.reps",[own,a.item]);
    assert.equal((await db.query('select reps from set_logs where session_id=$1',[own])).rows[0].reps,9);
    const otherDay=randomUUID(), otherBlock=randomUUID(), otherItem=randomUUID();
    await db.query("insert into plan_days(id,plan_id,day_index,name,focus) values($1,$2,1,'Other','Strength')",[otherDay,a.plan]);
    await db.query("insert into plan_blocks(id,plan_day_id,block_index,kind,title) values($1,$2,0,'straight','Other')",[otherBlock,otherDay]);
    await db.query("insert into plan_items(id,block_id,item_index,exercise_id) values($1,$2,0,'press')",[otherItem,otherBlock]);
    await assert.rejects(db.query("insert into set_logs(session_id,plan_item_id,exercise_id,set_index) values($1,$2,'press',2)",[own,otherItem]),{code:'42501'},'different day in same account must also be rejected');
    // Null item IDs retain historic logs when an item was deleted.
    await db.query("insert into set_logs(session_id,exercise_id,set_index,reps) values($1,'retired-exercise',1,8)",[own]);
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('avatars',$1)",[b.user+'/stolen.jpg']),{code:'42501'});
    await assert.rejects(db.query('update storage.objects set name=$1 where id=$2',[b.user+'/stolen.jpg',a.avatar]),{code:'42501'});
    assert.equal((await db.query('delete from storage.objects where id=$1 returning id',[b.avatar])).rows.length,0);
    await as('', 'anon');
    for(const table of tables) {
      try { assert.equal((await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n,0,table+' must not expose rows to anon'); }
      catch(error) { if(error.code!=='42501') throw error; }
    }
    await assert.rejects(db.query('insert into sessions(user_id,plan_day_id,local_day) values($1,$2,current_date)',[a.user,a.day]),{code:'42501'});
    // Existing avatar policy intentionally permits public reads; this does not
    // establish private image delivery or cover actual Storage upload behavior.
    assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n,2);
    console.log('PASS account-scoped reads, foreign parent writes, exercise/day consistency, legitimate set corrections, anonymous denial and avatar write ownership.');
    console.log('Avatar reads remain public. Production/API and native isolation verification remain release checks.');
  } finally { await db.close(); }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
