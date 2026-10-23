const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const api = () => require('./dev-db.cjs');
const status = {
  API_URL: 'http://127.0.0.1:54321',
  DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  ANON_KEY: 'sb_publishable_local_test_public_key_123456',
  SERVICE_ROLE_KEY: 'must-never-be-written',
};

test('local client env contains only local public configuration', () => {
  const output = api().clientEnvironment(status);
  assert.match(output, /APP_ENV=local\nEXPO_PUBLIC_APP_ENV=local/);
  assert.match(output, /EXPO_PUBLIC_SUPABASE_URL=http:\/\/127\.0\.0\.1:54321/);
  assert.match(output, /EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_local_test_public_key_123456/);
  assert.doesNotMatch(output, /must-never-be-written|SERVICE_ROLE|DB_URL|postgres:/);
});

test('seed and env reject every nonlocal service origin before any request', () => {
  for (const url of ['https://asbudyijvunpnhrhsubm.supabase.co', 'http://localhost:54321', 'http://127.0.0.1:54322', 'http://127.0.0.1:54321@evil.invalid', 'http://127.0.0.1:54321/path', 'http://127.0.0.1:54321?next=evil']) {
    assert.throws(() => api().assertLocalStatus({ ...status, API_URL: url }), /local/);
  }
  assert.throws(() => api().assertLocalStatus({ ...status, DB_URL: 'postgresql://postgres:pass@prod.invalid/postgres' }), /local/);
  assert.throws(() => api().clientEnvironment({ ...status, ANON_KEY: 'one\nEXPO_PUBLIC_ADMIN=secret' }), /key/);
  const jwt = (role) => `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  assert.throws(() => api().clientEnvironment({ ...status, ANON_KEY: jwt('service_role') }), /anon/);
  assert.match(api().clientEnvironment({ ...status, ANON_KEY: jwt('anon') }), /EXPO_PUBLIC_SUPABASE_KEY=ey/);
});

test('wrapper refuses arbitrary flags and requires local reset confirmation', () => {
  assert.throws(() => api().parseCommand(['start', '--linked']), /usage/);
  assert.throws(() => api().parseCommand(['reset']), /confirm-local-reset/);
  assert.equal(api().parseCommand(['reset', '--confirm-local-reset']), 'reset');
  assert.equal(api().parseCommand(['start']), 'start');
  assert.throws(() => api().parseCommand(['db', 'push']), /usage/);
});

test('local subprocess drops hosted Supabase credentials and rejects remote Docker', () => {
  const env = api().localProcessEnvironment({ PATH: '/bin', SUPABASE_ACCESS_TOKEN: 'secret', SUPABASE_DB_PASSWORD: 'secret', EXPO_PUBLIC_SUPABASE_URL: 'https://prod.invalid', DOCKER_HOST: 'unix:///tmp/docker.sock' });
  assert.equal(env.PATH, '/bin');
  assert.equal(env.SUPABASE_ACCESS_TOKEN, undefined);
  assert.equal(env.SUPABASE_DB_PASSWORD, undefined);
  assert.equal(env.EXPO_PUBLIC_SUPABASE_URL, undefined);
  assert.throws(() => api().localProcessEnvironment({ DOCKER_HOST: 'tcp://remote:2375' }), /Docker/);
});

test('effective Docker context cannot redirect local commands to a remote daemon', () => {
  assert.throws(() => api().resolvedDockerEnvironment({ PATH: '/bin' }, () => 'ssh://prod.example.test'), /local Docker/);
  assert.throws(() => api().resolvedDockerEnvironment({ DOCKER_CONTEXT: 'remote', DOCKER_HOST: 'unix:///tmp/local.sock' }, () => 'tcp://prod:2375'), /local Docker/);
  let inspected;
  const env = api().resolvedDockerEnvironment({ DOCKER_CONTEXT: 'colima', SUPABASE_ACCESS_TOKEN: 'secret' }, (name) => { inspected = name; return 'unix:///tmp/colima.sock'; });
  assert.equal(inspected, 'colima');
  assert.equal(env.DOCKER_HOST, 'unix:///tmp/colima.sock');
  assert.equal(env.DOCKER_CONTEXT, undefined);
  assert.equal(env.SUPABASE_ACCESS_TOKEN, undefined);
});

test('env generation refuses an existing file, preserving local developer settings', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'trainer-env-'));
  try {
    const output = path.join(directory, '.env.local');
    api().writeClientEnvironment(status, directory);
    assert.doesNotMatch(readFileSync(output, 'utf8'), /must-never-be-written/);
    writeFileSync(output, 'do not overwrite');
    assert.throws(() => api().writeClientEnvironment(status, directory), /exists/);
    assert.equal(readFileSync(output, 'utf8'), 'do not overwrite');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Auth seed uses fixed synthetic accounts and rejects HTTP redirects', async () => {
  const requests = [];
  await api().seedAccounts(status, async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ id: 'synthetic-user' }) };
  });
  assert.equal(requests.length, 2);
  for (const { url, options } of requests) {
    assert.equal(url, 'http://127.0.0.1:54321/auth/v1/admin/users');
    assert.equal(options.redirect, 'error');
    assert.match(JSON.parse(options.body).email, /@example\.test$/);
    assert.equal(JSON.parse(options.body).email_confirm, true);
  }
  let called = false;
  await assert.rejects(api().seedAccounts({ ...status, API_URL: 'https://production.supabase.co' }, async () => { called = true; }), /local/);
  assert.equal(called, false);
});

test('database tests can address only the configured local Supabase container', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'trainer-db-'));
  try {
    mkdirSync(path.join(dir, 'supabase/tests'), { recursive: true });
    writeFileSync(path.join(dir, 'supabase/tests', 'example.sql'), 'select true;');
    const plan = api().databaseTestCommands(dir);
    assert.equal(plan.length, 1);
    assert.deepEqual(plan[0].args, ['exec', '-i', 'supabase_db_office-gym-trainer-local', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']);
    assert.equal(plan[0].input, 'select true;');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
