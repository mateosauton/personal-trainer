const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { deployPreview } = require('./deploy-preview.cjs');

const production = 'asbudyijvunpnhrhsubm';
const preview = 'previewprojectabcdef';
const registry = { development: { projectRef: null }, preview: { projectRef: preview }, production: { projectRef: production } };
const disabled = { ...registry, preview: { projectRef: null } };
const environment = (patch = {}) => ({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'codex/example', APP_ENV: 'preview',
  EXPO_PUBLIC_APP_ENV: 'preview', EXPO_PUBLIC_SUPABASE_URL: `https://${preview}.supabase.co`,
  EXPO_PUBLIC_SUPABASE_KEY: 'sb_publishable_synthetic_preview_public_key', ...patch });
function attempt(env = environment(), selectedRegistry = registry, args = [], child = { status: 0 }) {
  const calls = [], messages = [];
  return { calls, messages, run: () => deployPreview(args, { env, registry: selectedRegistry,
    spawn: (...parameters) => { calls.push(parameters); return child; }, log: (message) => messages.push(message) }) };
}

test('explicitly disabled preview skips before any child, even with old production backend settings', () => {
  const fixture = attempt(environment({ APP_ENV: undefined, EXPO_PUBLIC_APP_ENV: undefined,
    EXPO_PUBLIC_SUPABASE_URL: `https://${production}.supabase.co`, EXPO_PUBLIC_SUPABASE_KEY: 'private-fixture-never-log' }), disabled);
  assert.deepEqual(fixture.run(), { skipped: true });
  assert.equal(fixture.calls.length, 0);
  assert.deepEqual(fixture.messages, ['SKIP_PREVIEW: isolated backend not registered; no build or upload performed.']);
});

for (const [name, patch] of [
  ['missing provider', { WORKERS_CI: undefined }], ['wrong provider value', { WORKERS_CI: 'true' }],
  ['missing branch', { WORKERS_CI_BRANCH: undefined }], ['blank branch', { WORKERS_CI_BRANCH: ' ' }],
  ['production branch', { WORKERS_CI_BRANCH: 'master' }], ['legacy pages branch', { WORKERS_CI_BRANCH: 'gh-pages' }],
  ['legacy CDN branch', { WORKERS_CI_BRANCH: 'cdn' }], ['EAS context', { EAS_BUILD_PROFILE: 'preview' }],
  ['Vercel context', { VERCEL_ENV: 'preview' }], ['explicit production target', { APP_ENV: 'production' }],
  ['explicit public production target', { EXPO_PUBLIC_APP_ENV: 'production' }],
]) test(`disabled preview still rejects ${name}`, () => {
  const fixture = attempt(environment(patch), disabled);
  assert.throws(fixture.run);
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.messages.length, 0);
});

for (const malformed of [{}, { preview: {} }, { preview: null }, { ...registry, preview: { projectRef: '' } },
  { ...registry, preview: { projectRef: false } }]) test(`malformed registry cannot become a successful skip: ${JSON.stringify(malformed.preview)}`, () => {
  const fixture = attempt(environment(), malformed);
  assert.throws(fixture.run);
  assert.equal(fixture.calls.length, 0);
});

test('registered preview validates before uploading only a Worker version with dotenv disabled', () => {
  const fixture = attempt(environment({ EXPO_NO_DOTENV: '0' }));
  assert.deepEqual(fixture.run(), { skipped: false });
  assert.equal(fixture.calls.length, 1);
  const [command, args, options] = fixture.calls[0];
  assert.equal(command, 'npx');
  assert.deepEqual(args, ['--yes', 'wrangler', 'versions', 'upload']);
  assert.equal(options.env.EXPO_NO_DOTENV, '1');
  assert.equal(options.env.APP_ENV, 'preview');
  assert.equal(options.stdio, 'inherit');
  assert.equal(options.shell, false);
});

for (const [name, patch] of [
  ['missing marker', { APP_ENV: undefined }], ['mismatched marker', { EXPO_PUBLIC_APP_ENV: undefined }],
  ['production URL', { EXPO_PUBLIC_SUPABASE_URL: `https://${production}.supabase.co` }],
  ['missing key', { EXPO_PUBLIC_SUPABASE_KEY: undefined }], ['administrative key', { EXPO_PUBLIC_SUPABASE_KEY: 'sb_secret_forbidden' }],
  ['developer password', { EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'private-fixture' }],
]) test(`registered preview fails instead of skipping for ${name}`, () => {
  const fixture = attempt(environment(patch));
  assert.throws(fixture.run);
  assert.equal(fixture.calls.length, 0);
});

test('shared production backend is rejected before uploading', () => {
  const fixture = attempt(environment(), { ...registry, preview: { projectRef: production } });
  assert.throws(fixture.run, /distinct backend/);
  assert.equal(fixture.calls.length, 0);
});

test('arguments cannot bypass the fixed preview upload command, including when disabled', () => {
  for (const selectedRegistry of [disabled, registry]) {
    const fixture = attempt(environment(), selectedRegistry, ['--force']);
    assert.throws(fixture.run);
    assert.equal(fixture.calls.length, 0);
  }
});

test('upload failures propagate without disclosing child error details', () => {
  for (const child of [{ status: 1 }, { status: null }, { error: new Error('private-fixture'), status: null }]) {
    const fixture = attempt(environment(), registry, [], child);
    assert.throws(fixture.run, (error) => /upload failed/i.test(error.message) && !error.message.includes('private-fixture'));
    assert.equal(fixture.calls.length, 1);
  }
});

test('actual disabled CLI succeeds without invoking npx or touching stale deployable output', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'trainer-preview-skip-'));
  try {
    mkdirSync(path.join(directory, 'bin'));
    mkdirSync(path.join(directory, 'dist'));
    mkdirSync(path.join(directory, 'scripts'));
    mkdirSync(path.join(directory, 'config'));
    copyFileSync(path.join(__dirname, 'deploy-preview.cjs'), path.join(directory, 'scripts/deploy-preview.cjs'));
    copyFileSync(path.join(__dirname, '../config/environment-policy.cjs'), path.join(directory, 'config/environment-policy.cjs'));
    writeFileSync(path.join(directory, 'config/environments.json'), JSON.stringify(disabled));
    writeFileSync(path.join(directory, 'dist/index.html'), 'stale artifact');
    writeFileSync(path.join(directory, 'bin/npx'), '#!/bin/sh\necho UNEXPECTED_CHILD\nexit 91\n', { mode: 0o700 });
    const result = spawnSync(process.execPath, [path.join(directory, 'scripts/deploy-preview.cjs')], { cwd: directory, encoding: 'utf8',
      env: { PATH: path.join(directory, 'bin'), WORKERS_CI: '1', WORKERS_CI_BRANCH: 'codex/example',
        EXPO_PUBLIC_SUPABASE_URL: `https://${production}.supabase.co`, EXPO_PUBLIC_SUPABASE_KEY: 'private-fixture-never-log' } });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^SKIP_PREVIEW:/);
    assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_CHILD|private-fixture/);
    assert.equal(readFileSync(path.join(directory, 'dist/index.html'), 'utf8'), 'stale artifact');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
