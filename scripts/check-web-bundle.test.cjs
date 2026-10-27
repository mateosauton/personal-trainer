const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { buildCheckPlan } = require('./check-web-bundle.cjs');

test('bundle check uses a fixed non-release directory and synthetic public configuration', () => {
  const plan = buildCheckPlan('/tmp/trainer', { PATH: '/bin', EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'private-fixture', EXPO_PUBLIC_UNEXPECTED: 'secret' });
  assert.equal(plan.command, process.execPath);
  assert.deepEqual(plan.args, [path.join('/tmp/trainer', 'node_modules/expo/bin/cli'), 'export', '--platform', 'web', '--output-dir', '.expo/web-check']);
  assert.equal(plan.env.APP_ENV, 'production');
  assert.equal(plan.env.EXPO_PUBLIC_APP_ENV, 'production');
  assert.equal(plan.env.EXPO_NO_DOTENV, '1');
  assert.equal(plan.env.EXPO_PUBLIC_SUPABASE_KEY, 'sb_publishable_BUNDLE_CHECK_FIXTURE_ONLY');
  assert.equal(plan.env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD, undefined);
  assert.equal(plan.env.EXPO_PUBLIC_UNEXPECTED, undefined);
  assert.equal(plan.env.PATH, '/bin');
});

test('bundle check cannot run in a hosted deployment context', () => {
  for (const field of ['WORKERS_CI', 'WORKERS_CI_BRANCH', 'VERCEL_ENV', 'EAS_BUILD_PROFILE']) {
    assert.throws(() => buildCheckPlan('/tmp/trainer', { [field]: 'preview' }), /deployment context/);
  }
});
