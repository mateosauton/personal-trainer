const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { resolveCommandContext } = require('../config/environment-policy.cjs');
const production = 'asbudyijvunpnhrhsubm';
const env = { ...process.env, APP_ENV: 'production', EXPO_PUBLIC_APP_ENV: 'production', EXPO_PUBLIC_SUPABASE_URL: `https://${production}.supabase.co`, EXPO_PUBLIC_SUPABASE_KEY: 'sb_publishable_synthetic_public_key_for_checks' };
for (const name of ['TRAINER_UPDATE_APP_ENV', 'EAS_BUILD_PROFILE', 'VERCEL_ENV', 'WORKERS_CI', 'WORKERS_CI_BRANCH', 'EXPO_PUBLIC_DEV_LOGIN_EMAIL', 'EXPO_PUBLIC_DEV_LOGIN_PASSWORD', 'EXPO_PUBLIC_ALLOW_DEV_LOGIN']) delete env[name];
const run = (args, patch = {}) => spawnSync(process.execPath, ['scripts/verify-environment.cjs', ...args], { env: { ...env, ...patch }, encoding: 'utf8' });

test('preflight validates explicit target and never prints the public key', () => {
  const result = run(['--distribution', '--environment', 'production']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /production/);
  assert.equal(result.stdout.includes(env.EXPO_PUBLIC_SUPABASE_KEY), false);
});
test('preflight rejects relabeling and unknown arguments', () => {
  for (const args of [['--distribution', '--environment', 'preview'], ['--allow-production'], ['--environment'], ['--development', '--distribution']]) {
    const result = run(args);
    assert.notEqual(result.status, 0);
  }
});
test('mock cannot pass distribution preflight', () => {
  const result = run(['--distribution'], { APP_ENV: 'mock', EXPO_PUBLIC_APP_ENV: 'mock', EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', EXPO_PUBLIC_SUPABASE_KEY: 'sb_publishable_LOCAL_TEST_FIXTURE_ONLY' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mock/i);
});
test('command context identifies only explicit harmless EAS management calls', () => {
  for (const command of ['env:pull', 'env:list', 'env:exec', 'build:view', 'update:view', 'channel:view', 'config']) assert.equal(resolveCommandContext(['node', 'eas', command]).readOnly, true);
  for (const command of ['export', 'build', 'prebuild', 'unknown']) assert.notEqual(resolveCommandContext(['node', 'expo', command]).readOnly, true);
  assert.equal(resolveCommandContext(['node', 'expo', 'start']).purpose, 'development');
  assert.equal(resolveCommandContext(['node', 'expo', 'start', '--no-dev']).purpose, 'distribution');
});
test('routing helper binds supplied channel, EAS environment and profile arguments to one target', () => {
  assert.equal(resolveCommandContext(['node', 'eas', 'update', '--channel', 'release-test', '--environment', 'production']).expectedEnvironment, 'production');
  for (const args of [
    ['update', '--channel', 'production', '--environment', 'preview'],
    ['update', '--channel', 'production'],
    ['update', '--branch', 'preview', '--environment', 'production'],
    ['build', '--profile', 'unknown'],
  ]) assert.throws(() => resolveCommandContext(['node', 'eas', ...args]), /environment|channel|profile/i);
  assert.equal(resolveCommandContext(['node', 'eas', 'build', '--profile=preview']).expectedEnvironment, 'preview');
});
test('Expo config emits routing metadata and preserves existing app identity', () => {
  const result = spawnSync(process.execPath, ['-e', "const app = require('./app.config.js')({config:require('./app.json').expo}); console.log(JSON.stringify(app))"], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const app = JSON.parse(result.stdout);
  assert.equal(app.extra.appEnvironment, 'production');
  assert.equal(app.extra.backendProjectRef, production);
  assert.equal(app.ios.bundleIdentifier, 'co.officegym.trainer');
  assert.equal(app.extra.eas.projectId, 'aa04a2aa-93a1-4e8f-ad57-84ed3e8c2bf5');
});
test('Expo configuration refuses direct exports with missing markers or privileged keys', () => {
  for (const patch of [{ APP_ENV: '' }, { EXPO_PUBLIC_SUPABASE_KEY: 'sb_secret_never_expose' }, { APP_ENV: 'preview', EXPO_PUBLIC_APP_ENV: 'preview' }]) {
    const result = spawnSync(process.execPath, ['-e', "require('./app.config.js')({config:require('./app.json').expo})"], { env: { ...env, ...patch }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  }
});

test('rejects ambiguous repeated EAS routing flags', () => {
  for (const args of [
    ['update', '--channel', 'production', '--channel=preview', '--environment', 'preview'],
    ['update', '--channel', 'production', '--environment', 'production', '--environment=preview'],
    ['build', '--profile', 'production', '--profile=preview'],
  ]) assert.throws(() => resolveCommandContext(['node', 'eas', ...args]), /ambiguous|repeated/i);
});

test('routing helper rejects relabeling a configured preview backend into production', () => {
  const { validateProcessEnvironment } = require('../config/environment-policy.cjs');
  const context = resolveCommandContext(['node', 'eas', 'update', '--channel', 'production', '--environment', 'production']);
  assert.throws(() => validateProcessEnvironment({ ...env, APP_ENV: 'preview', EXPO_PUBLIC_APP_ENV: 'preview', EXPO_PUBLIC_SUPABASE_URL: 'https://previewprojectabcdef.supabase.co' }, context, { development: { projectRef: 'devprojectabcdefghij' }, preview: { projectRef: 'previewprojectabcdef' }, production: { projectRef: production } }), /expected deployment environment/);
});

test('every EAS profile pins its intended environment and disables automatic dotenv', () => {
  const { EAS_PROFILE_ENVIRONMENTS } = require('../config/environment-policy.cjs');
  for (const [name, profile] of Object.entries(require('../eas.json').build)) {
    assert.equal(profile.environment, EAS_PROFILE_ENVIRONMENTS[name]);
    assert.deepEqual(profile.env, { APP_ENV: profile.environment, EXPO_PUBLIC_APP_ENV: profile.environment, EXPO_NO_DOTENV: '1' });
  }
});

// EAS CLI 23.2.0 project/expoConfig.js spawns exactly this child command before
// it knows the project ID needed to fetch EAS variables. The child's argv no
// longer contains env:list/env:pull/env:exec.
const expoCommand = (args, patch = {}) => {
  const childEnv = { ...env, EXPO_NO_DOTENV: '1', ...patch };
  for (const name of ['APP_ENV', 'EXPO_PUBLIC_APP_ENV', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_KEY']) if (childEnv[name] === undefined) delete childEnv[name];
  return spawnSync(process.execPath, ['node_modules/expo/bin/cli', ...args], { env: childEnv, encoding: 'utf8', timeout: 20000 });
};

test('actual Expo discovery works before EAS has fetched environment variables', () => {
  const result = expoCommand(['config', '--json'], { APP_ENV: undefined, EXPO_PUBLIC_APP_ENV: undefined, EXPO_PUBLIC_SUPABASE_URL: undefined, EXPO_PUBLIC_SUPABASE_KEY: undefined });
  assert.equal(result.status, 0, result.stderr);
  const app = JSON.parse(result.stdout);
  assert.equal(app.extra.eas.projectId, 'aa04a2aa-93a1-4e8f-ad57-84ed3e8c2bf5');
  assert.equal(app.extra.appEnvironment, undefined);
  assert.equal(app.extra.backendProjectRef, undefined);
});

test('actual Expo discovery can repair incomplete or unprovisioned development configuration', () => {
  for (const patch of [
    { APP_ENV: 'development', EXPO_PUBLIC_APP_ENV: 'development' },
    { APP_ENV: 'development', EXPO_PUBLIC_APP_ENV: undefined, EXPO_PUBLIC_SUPABASE_URL: undefined },
    { EXPO_PUBLIC_SUPABASE_KEY: 'sb_secret_not_a_client_key' },
  ]) {
    const result = expoCommand(['config', '--json'], patch);
    assert.equal(result.status, 0, result.stderr);
    const app = JSON.parse(result.stdout);
    assert.equal(app.extra.eas.projectId, 'aa04a2aa-93a1-4e8f-ad57-84ed3e8c2bf5');
    assert.equal(app.extra.appEnvironment, undefined);
    assert.equal(app.extra.backendProjectRef, undefined);
    assert.equal(result.stdout.includes(patch.EXPO_PUBLIC_SUPABASE_KEY || env.EXPO_PUBLIC_SUPABASE_KEY), false);
  }
});

test('actual Expo public discovery retains validated routing evidence when configured', () => {
  const result = expoCommand(['config', '--type', 'public', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const app = JSON.parse(result.stdout);
  assert.equal(app.extra.appEnvironment, 'production');
  assert.equal(app.extra.backendProjectRef, production);
});

test('actual Expo exports and native prebuilds still fail closed before producing artifacts', () => {
  for (const args of [
    ['export', '--platform', 'web', '--output-dir', '/tmp/trainer-forbidden-export'],
    ['prebuild', '--no-install', '--platform', 'android'],
  ]) for (const patch of [
    { APP_ENV: undefined, EXPO_PUBLIC_APP_ENV: undefined },
    { APP_ENV: 'development', EXPO_PUBLIC_APP_ENV: 'development' },
    { EXPO_PUBLIC_SUPABASE_KEY: 'sb_secret_not_a_client_key' },
  ]) {
    const result = expoCommand(args, patch);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /APP_ENV|not provisioned|public Supabase/);
  }
});

test('actual Expo export enforces the private update target after EAS loses outer argv', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trainer-update-target-'));
  const output = join(directory, 'forbidden-export');
  try {
    const result = expoCommand(['export', '--platform', 'web', '--output-dir', output], { TRAINER_UPDATE_APP_ENV: 'preview' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /TRAINER_UPDATE_APP_ENV/);
    assert.equal(existsSync(output), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('actual Expo discovery omits routing proof if the private update target disagrees', () => {
  const result = expoCommand(['config', '--json'], { TRAINER_UPDATE_APP_ENV: 'preview' });
  assert.equal(result.status, 0, result.stderr);
  const app = JSON.parse(result.stdout);
  assert.equal(app.extra.appEnvironment, undefined);
  assert.equal(app.extra.backendProjectRef, undefined);
});
