const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolveCommandContext } = require('../config/environment-policy.cjs');
const production = 'asbudyijvunpnhrhsubm';
const env = { ...process.env, APP_ENV: 'production', EXPO_PUBLIC_APP_ENV: 'production', EXPO_PUBLIC_SUPABASE_URL: `https://${production}.supabase.co`, EXPO_PUBLIC_SUPABASE_KEY: 'sb_publishable_synthetic_public_key_for_checks' };
for (const name of ['EAS_BUILD_PROFILE', 'VERCEL_ENV', 'WORKERS_CI', 'WORKERS_CI_BRANCH', 'EXPO_PUBLIC_DEV_LOGIN_EMAIL', 'EXPO_PUBLIC_DEV_LOGIN_PASSWORD', 'EXPO_PUBLIC_ALLOW_DEV_LOGIN']) delete env[name];
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
  for (const command of ['env:pull', 'env:list', 'env:exec', 'build:view', 'update:view', 'channel:view']) assert.equal(resolveCommandContext(['node', 'eas', command]).readOnly, true);
  for (const command of ['export', 'build', 'prebuild', 'config', 'unknown']) assert.notEqual(resolveCommandContext(['node', 'expo', command]).readOnly, true);
  assert.equal(resolveCommandContext(['node', 'expo', 'start']).purpose, 'development');
  assert.equal(resolveCommandContext(['node', 'expo', 'start', '--no-dev']).purpose, 'distribution');
});
test('EAS update binds channel, explicit EAS environment and profile to one target', () => {
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

test('EAS update command cannot relabel a configured preview backend into production', () => {
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
