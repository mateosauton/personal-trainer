// Runs the real migrations and security assertions in an in-memory database.
// No Supabase project, credentials, or network connection is used.
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { readBaseline } = require('./migration-baseline.cjs');

const root = path.resolve(__dirname, '../supabase');
const sqlFiles = (directory) => readdirSync(path.join(root, directory))
  .filter((name) => name.endsWith('.sql')).sort();

async function runSchema(mode, baseline) {
  const db = new PGlite();
  let current = 'database bootstrap';
  try {
    await db.exec(`
      create schema auth;
      create schema storage;
      create role anon;
      create role authenticated;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table storage.buckets(id text primary key,name text,public boolean);
      create table storage.objects(
        id uuid primary key default gen_random_uuid(),
        bucket_id text references storage.buckets,
        name text
      );
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as
        $$select string_to_array($1,'/')$$;
      grant usage on schema public,auth,storage to anon,authenticated;
      grant select,insert,update,delete on storage.objects to anon,authenticated;
      alter default privileges in schema public
        grant select,insert,update,delete on tables to anon,authenticated;
      set plpgsql.check_asserts=on;
    `);

    const migrations = sqlFiles('migrations');
    const tests = sqlFiles('tests');
    assert(migrations.length > 0, 'No database migrations found');
    assert(tests.length > 0, 'No database tests found');
    const baselineFiles = baseline.migrations.map(({ file }) => file);
    assert.deepEqual(migrations.slice(0, baselineFiles.length), baselineFiles,
      'New migrations must sort after the deployed-source baseline');
    const apply = async (files) => { for (const name of files) {
      current = `migration ${name}`;
      await db.exec(readFileSync(path.join(root, 'migrations', name), 'utf8'));
    } };
    if (mode === 'fresh') {
      await apply(migrations);
    } else {
      await apply(baselineFiles);
      // Existing account, workout and receipt rows make destructive upgrades fail.
      await db.exec(`
        insert into auth.users(id) values ('91000000-0000-4000-8000-000000000001'),
          ('94000000-0000-4000-8000-000000000001'),('95000000-0000-4000-8000-000000000001');
        select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',false);
        select public.save_plan('{"name":"Upgrade fixture","split":"full_body","days":[{"name":"Day","focus":"Mixed","blocks":[{"kind":"straight","title":"Work","rounds":1,"rest_seconds":30,"items":[{"exercise_id":"hold","sets":1,"reps_low":8,"reps_high":12,"seconds":40}]}]}]}');
        insert into public.sessions(id,user_id,plan_day_id,local_day,tz)
          select '92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001',d.id,'2026-10-07','America/Los_Angeles'
          from public.plan_days d join public.plans p on p.id=d.plan_id where p.user_id='91000000-0000-4000-8000-000000000001';
        select public.log_set_versioned('92000000-0000-4000-8000-000000000001',
          jsonb_build_object('plan_item_id',i.id,'exercise_id','hold','set_index',1,'reps',null,'seconds',40,
            'weight_kg',0,'is_bodyweight',false,'added_load_kg',0,'rpe',null),
          '93000000-0000-4000-8000-000000000001',1,0,'2026-10-07T12:00:00Z')
          from public.plan_items i;
        insert into public.session_progress_results(session_id,user_id,result)
          values('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','[]');
        select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',false);
        select public.save_plan('{"name":"Legacy timezone fixture","split":"full_body","days":[{"name":"Legacy day","focus":"Mixed","blocks":[]}]}');
        insert into public.sessions(user_id,plan_day_id,local_day,tz)
          select '94000000-0000-4000-8000-000000000001',d.id,'2026-01-01','not/a-zone'
          from public.plan_days d join public.plans p on p.id=d.plan_id where p.user_id='94000000-0000-4000-8000-000000000001';
        select set_config('request.jwt.claim.sub','',false);
      `);
      const tables = (await db.query(`select table_name, string_agg(quote_ident(column_name),',' order by ordinal_position) as columns
        from information_schema.columns where table_schema='public' group by table_name order by table_name`)).rows;
      const snapshot = async () => Promise.all(tables.map(async ({ table_name, columns }) => [table_name,
        (await db.query(`select row_to_json(row)::text as data from (select ${columns} from public.${table_name}) row order by data`)).rows]));
      const before = await snapshot();
      await apply(migrations.slice(baselineFiles.length));
      assert.deepEqual(await snapshot(), before, 'Upgrade changed existing account/workout/receipt data');
      assert.deepEqual((await db.query(`select id,home_timezone from public.profiles order by id`)).rows, [
        { id: '91000000-0000-4000-8000-000000000001', home_timezone: 'America/Los_Angeles' },
        { id: '94000000-0000-4000-8000-000000000001', home_timezone: 'UTC' },
        { id: '95000000-0000-4000-8000-000000000001', home_timezone: 'UTC' },
      ], 'Upgrade must infer a valid recorded timezone and use UTC for invalid or missing history');
      console.log(`PASS upgrade preserves deployed-source fixture rows across ${migrations.length - baselineFiles.length} pending migrations`);
    }
    for (const name of tests) {
      current = `test ${name}`;
      const sql = readFileSync(path.join(root, 'tests', name), 'utf8')
        .replace(/^\\set ON_ERROR_STOP on\r?$/gm, '');
      await db.exec(sql);
      console.log(`PASS ${mode}: ${name}`);
    }
    const schema = await db.query(`
      select 'column' as kind, table_schema||'.'||table_name||'.'||column_name as name,
        concat_ws('|',data_type,udt_name,is_nullable,column_default) as definition
        from information_schema.columns where table_schema in ('public','storage')
      union all select 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',pg_get_functiondef(p.oid)
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      union all select 'policy',schemaname||'.'||tablename||'.'||policyname,
        concat_ws('|',permissive,roles::text,cmd,qual,with_check) from pg_policies where schemaname in ('public','storage')
      union all select 'index',schemaname||'.'||indexname,indexdef from pg_indexes where schemaname='public'
      union all select 'constraint',n.nspname||'.'||c.relname||'.'||k.conname,pg_get_constraintdef(k.oid)
        from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname in ('public','storage')
      union all select 'table grant',table_schema||'.'||table_name||'.'||grantee,privilege_type
        from information_schema.table_privileges where table_schema in ('public','storage')
      union all select 'function grants',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',coalesce(p.proacl::text,'default')
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      union all select 'rls',n.nspname||'.'||c.relname,concat_ws('|',c.relrowsecurity,c.relforcerowsecurity)
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage') and c.relkind='r'
      order by kind,name,definition
    `);
    console.log(`PASS ${mode}: ${migrations.length} migrations and ${tests.length} database test files`);
    return schema.rows;
  } catch (error) {
    throw new Error(`${current}: ${error.message}`, { cause: error });
  } finally {
    await db.close();
  }
}

(async () => {
  const baseline = readBaseline();
  const fresh = await runSchema('fresh', baseline);
  const upgraded = await runSchema('upgrade', baseline);
  assert.deepEqual(upgraded, fresh, 'Fresh and upgraded schemas differ');
  console.log('PASS fresh and baseline-upgrade columns, functions, grants, constraints, policies, indexes and RLS agree');
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
