// Runs the real migrations and security assertions in an in-memory database.
// No Supabase project, credentials, or network connection is used.
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '../supabase');
const sqlFiles = (directory) => readdirSync(path.join(root, directory))
  .filter((name) => name.endsWith('.sql')).sort();

(async () => {
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
    for (const name of migrations) {
      current = `migration ${name}`;
      await db.exec(readFileSync(path.join(root, 'migrations', name), 'utf8'));
    }
    for (const name of tests) {
      current = `test ${name}`;
      const sql = readFileSync(path.join(root, 'tests', name), 'utf8')
        .replace(/^\\set ON_ERROR_STOP on\r?$/gm, '');
      await db.exec(sql);
      console.log(`PASS ${name}`);
    }
    console.log(`PASS ${migrations.length} migrations and ${tests.length} database test files`);
  } catch (error) {
    throw new Error(`${current}: ${error.message}`, { cause: error });
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
