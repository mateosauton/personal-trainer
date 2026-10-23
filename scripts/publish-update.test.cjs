const test = require('node:test');
const assert = require('node:assert/strict');
const { publishUpdate } = require('./publish-update.cjs');

const production = 'asbudyijvunpnhrhsubm';
const preview = 'previewprojectabcdef';
const registry = { development: { projectRef: null }, preview: { projectRef: preview }, production: { projectRef: production } };
const environment = (name = 'production', patch = {}) => ({
  APP_ENV: name, EXPO_PUBLIC_APP_ENV: name,
  EXPO_PUBLIC_SUPABASE_URL: `https://${registry[name].projectRef}.supabase.co`,
  EXPO_PUBLIC_SUPABASE_KEY: 'sb_publishable_synthetic_public_key_for_checks',
  EXPO_NO_DOTENV: '0', EXPO_TOKEN: 'fake-only-token', ...patch,
});
const args = (channel = 'release-test', platform = 'android', easEnvironment = 'production') => [
  '--channel', channel, '--environment', easEnvironment, '--platform', platform, '--message', 'Candidate workout fix',
];
function attempt(argv, env = environment(), options = {}) {
  const invocations = [];
  const spawn = (...parameters) => { invocations.push(parameters); return { status: 0 }; };
  return { invocations, run: () => publishUpdate(argv, { env, registry, spawn, ...options }) };
}

test('publishes one exact production candidate with pinned EAS and dotenv disabled', () => {
  const fixture = attempt(args());
  fixture.run();
  assert.equal(fixture.invocations.length, 1);
  const [command, commandArgs, options] = fixture.invocations[0];
  assert.equal(command, 'npx');
  assert.deepEqual(commandArgs, ['--yes', 'eas-cli@23.2.0', 'update', ...args(), '--non-interactive']);
  assert.equal(options.env.EXPO_NO_DOTENV, '1');
  assert.equal(options.env.APP_ENV, 'production');
  assert.equal(options.env.TRAINER_UPDATE_APP_ENV, 'production');
  assert.equal(options.stdio, 'inherit');
});

test('publishes an explicit iOS preview only with its isolated configured backend', () => {
  const fixture = attempt(args('preview', 'ios', 'preview'), environment('preview'));
  fixture.run();
  assert.deepEqual(fixture.invocations[0][1], ['--yes', 'eas-cli@23.2.0', 'update', ...args('preview', 'ios', 'preview'), '--non-interactive']);
  assert.equal(fixture.invocations[0][2].env.TRAINER_UPDATE_APP_ENV, 'preview');
  assert.equal(fixture.invocations[0][2].env.EXPO_PUBLIC_SUPABASE_URL, `https://${preview}.supabase.co`);
});

for (const [name, argv] of [
  ['direct production publishing', args('production')],
  ['preview values sent to production release-test', args('release-test', 'android', 'preview')],
  ['production values sent to preview', args('preview')],
  ['implicit platform', args('release-test', 'all')],
  ['unknown channel', args('unknown')],
  ['branch targeting', [...args(), '--branch', 'production']],
  ['skipped bundling', [...args(), '--skip-bundler']],
  ['old artifact directory', [...args(), '--input-dir', 'dist']],
  ['duplicate channel', [...args(), '--channel', 'preview']],
  ['unknown options', [...args(), '--auto']],
  ['target marker passed as a public option', [...args(), '--TRAINER_UPDATE_APP_ENV', 'preview']],
  ['missing message', args().slice(0, 6)],
  ['empty message', [...args().slice(0, 7), '   ']],
  ['argument disguised as message', [...args().slice(0, 7), '--skip-bundler']],
]) test(`rejects ${name} before invoking EAS`, () => {
  const fixture = attempt(argv);
  assert.throws(fixture.run);
  assert.equal(fixture.invocations.length, 0);
});

for (const [name, env] of [
  ['mismatched markers', environment('production', { APP_ENV: 'preview' })],
  ['missing markers', environment('production', { APP_ENV: undefined, EXPO_PUBLIC_APP_ENV: undefined })],
  ['preview deployment identity', environment('production', { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'feature' })],
  ['service-role key', environment('production', { EXPO_PUBLIC_SUPABASE_KEY: 'sb_secret_forbidden' })],
  ['developer credentials', environment('production', { EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'do-not-publish' })],
  ['wrong backend', environment('production', { EXPO_PUBLIC_SUPABASE_URL: `https://${preview}.supabase.co` })],
]) test(`rejects ${name} before invoking EAS`, () => {
  const fixture = attempt(args(), env);
  assert.throws(fixture.run);
  assert.equal(fixture.invocations.length, 0);
});

test('wrapper checks routing before EAS config discovery can erase the outer command', () => {
  const fixture = attempt(args('preview', 'android', 'production'), environment('preview'));
  assert.throws(fixture.run, /environment/i);
  assert.equal(fixture.invocations.length, 0);
});

test('unregistered preview cannot start the pinned CLI', () => {
  const fixture = attempt(args('preview', 'android', 'preview'), environment('preview'), { registry: undefined });
  assert.throws(fixture.run, /not provisioned/);
  assert.equal(fixture.invocations.length, 0);
});

test('propagates a failed EAS invocation as failure without exposing environment values', () => {
  assert.throws(() => publishUpdate(args(), { env: environment(), spawn: () => ({ status: 1 }) }), /EAS update failed/);
  assert.throws(() => publishUpdate(args(), { env: environment(), spawn: () => ({ error: new Error('fake-private-data'), status: null }) }), error => !error.message.includes('fake-private-data'));
});
