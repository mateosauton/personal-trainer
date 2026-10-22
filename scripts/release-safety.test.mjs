import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { bundleIdentity, releaseInputs, validateRelease } from './release-policy.mjs';
import { promoteRelease, queryEas } from './release-native.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = 'a'.repeat(40);
const RUNTIME = 'b'.repeat(40);
const PROJECT = 'aa04a2aa-93a1-4e8f-ad57-84ed3e8c2bf5';
const REF = 'asbudyijvunpnhrhsubm';
const GROUP = '11111111-1111-4111-8111-111111111111';
const TEST = '22222222-2222-4222-8222-222222222222';
const PRODUCTION = '33333333-3333-4333-8333-333333333333';
const PROMOTED = '44444444-4444-4444-8444-444444444444';
const expoConfig = { extra: { eas: { projectId: PROJECT }, appEnvironment: 'production', backendProjectRef: REF }, updates: { url: `https://u.expo.dev/${PROJECT}` } };
const config = { projectId: PROJECT, projectRef: REF, expoConfig };
function envFixture() { return { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/master', GITHUB_SHA: SHA,
  RELEASE_SHA: SHA, RELEASE_PLATFORM: 'android', RELEASE_GROUP: GROUP, RELEASE_TEST_BUILD: TEST, RELEASE_PRODUCTION_BUILD: PRODUCTION,
  RELEASE_PHONE_TESTED: 'true', RELEASE_EVIDENCE: 'https://github.com/example/trainer/issues/42',
  APP_ENV: 'production', EXPO_PUBLIC_APP_ENV: 'production', EXPO_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`, EXPO_PUBLIC_SUPABASE_KEY: `sb_publishable_${'x'.repeat(40)}`,
  EXPO_TOKEN: 'test-only-token', EXPO_NO_DOTENV: '1', GITHUB_ACTOR: 'tester', GITHUB_RUN_ID: '123' }; }
function evidenceFixture() {
  const build = { app: { id: PROJECT }, status: 'FINISHED', platform: 'ANDROID', resolvedEnvironment: 'production', isGitWorkingTreeDirty: false,
    gitCommitHash: SHA, developmentClient: false, isForIosSimulator: false, appIdentifier: 'co.officegym.trainer', runtime: { version: RUNTIME }, fingerprint: { hash: RUNTIME } };
  const channel = (name) => ({ name, isPaused: false, branchMapping: JSON.stringify({ version: 0, data: [{ branchId: `${name}-id`, branchMappingLogic: 'true' }] }), updateBranches: [{ id: `${name}-id`, name }] });
  return { builds: { test: { ...build, id: TEST, distribution: 'INTERNAL', buildProfile: 'release-test', updateChannel: { name: 'release-test' } }, production: { ...build, id: PRODUCTION, distribution: 'STORE', buildProfile: 'production', updateChannel: { name: 'production' } } },
    updatesByGroup: [{ id: 'candidate-update-id', group: GROUP, app: { id: PROJECT }, platform: 'android', gitCommitHash: SHA, isGitWorkingTreeDirty: false, environment: 'production',
      branch: { id: 'release-test-id', name: 'release-test' }, runtime: { version: RUNTIME }, fingerprint: { hash: RUNTIME }, codeSigningInfo: null, isRollBackToEmbedded: false,
      rolloutControlUpdate: null, rolloutPercentage: null, manifestHostOverride: null, assetHostOverride: null,
      manifestFragment: JSON.stringify({ launchAsset: { fileSHA256: 'javascript-hash', storageKey: 'javascript-key' }, assets: [{ fileSHA256: 'image-hash', storageKey: 'image-key' }], extra: { expoClient: expoConfig } }) }],
    app: { byId: { candidateChannel: channel('release-test'), productionChannel: channel('production') } } };
}

for (const [name, mutate] of [
  ['local dotenv loading', e => { delete e.EXPO_NO_DOTENV; }],
  ['push publishing', e => { e.GITHUB_EVENT_NAME = 'push'; }], ['non-master dispatch', e => { e.GITHUB_REF = 'refs/heads/feature'; }],
  ['short source SHA', e => { e.RELEASE_SHA = 'abc1234'; }], ['different dispatch source', e => { e.GITHUB_SHA = 'c'.repeat(40); }],
  ['implicit platform', e => { e.RELEASE_PLATFORM = 'all'; }], ['missing device attestation', e => { e.RELEASE_PHONE_TESTED = 'false'; }],
  ['missing test evidence', e => { e.RELEASE_EVIDENCE = ''; }], ['untrusted ID argument', e => { e.RELEASE_GROUP = '--channel production'; }],
]) test(`rejects ${name}`, () => { const env = envFixture(); mutate(env); assert.throws(() => releaseInputs(env)); });

test('accepts verified single-platform metadata', () => assert.equal(validateRelease(evidenceFixture(), releaseInputs(envFixture()), config).update.group, GROUP));
for (const [name, mutate] of [
  ['test build project', d => { d.builds.test.app = { id: 'other' }; }], ['production platform', d => { d.builds.production.platform = 'IOS'; }],
  ['unfinished build', d => { d.builds.test.status = 'IN_PROGRESS'; }], ['wrong profile', d => { d.builds.test.buildProfile = 'preview'; }],
  ['wrong channel', d => { d.builds.production.updateChannel.name = 'preview'; }], ['build environment', d => { d.builds.test.resolvedEnvironment = 'preview'; }],
  ['dirty binary source', d => { d.builds.test.isGitWorkingTreeDirty = true; }], ['unknown binary source', d => { d.builds.test.gitCommitHash = null; }],
  ['development binary', d => { d.builds.test.developmentClient = true; }], ['simulator binary', d => { d.builds.production.isForIosSimulator = true; }],
  ['application identifier', d => { d.builds.test.appIdentifier = 'example.wrong'; }], ['missing build fingerprint', d => { d.builds.production.fingerprint = null; }],
  ['binary runtime mismatch', d => { d.builds.production.runtime.version = 'c'.repeat(40); d.builds.production.fingerprint.hash = 'c'.repeat(40); }],
  ['candidate source mismatch', d => { d.updatesByGroup[0].gitCommitHash = 'c'.repeat(40); }], ['dirty candidate', d => { d.updatesByGroup[0].isGitWorkingTreeDirty = true; }],
  ['candidate environment', d => { d.updatesByGroup[0].environment = 'preview'; }], ['extra platform', d => { d.updatesByGroup.push({ ...d.updatesByGroup[0], platform: 'ios' }); }],
  ['signed candidate', d => { d.updatesByGroup[0].codeSigningInfo = { keyid: 'other', alg: 'rsa-v1_5-sha256' }; }], ['missing signing proof', d => { delete d.updatesByGroup[0].codeSigningInfo; }],
  ['active candidate rollout', d => { d.updatesByGroup[0].rolloutControlUpdate = { id: 'rollout' }; }], ['unknown manifest backend', d => { const m = JSON.parse(d.updatesByGroup[0].manifestFragment); m.extra.expoClient.extra.backendProjectRef = 'unknown'; d.updatesByGroup[0].manifestFragment = JSON.stringify(m); }],
  ['shared production branch', d => { d.app.byId.productionChannel.updateBranches[0].name = 'release-test'; }], ['paused channel', d => { d.app.byId.productionChannel.isPaused = true; }],
  ['channel rollout', d => { d.app.byId.productionChannel.branchMapping = JSON.stringify({ version: 1, data: [] }); }],
]) test(`rejects ${name}`, () => { const data = evidenceFixture(); mutate(data); assert.throws(() => validateRelease(data, releaseInputs(envFixture()), config)); });

function sandbox() {
  const directory = mkdtempSync(join(tmpdir(), 'trainer-release-'));
  mkdirSync(join(directory, 'bin'));
  mkdirSync(join(directory, 'node_modules/expo/bin'), { recursive: true });
  writeFileSync(join(directory, 'node_modules/expo/bin/cli'), `console.log(${JSON.stringify(JSON.stringify(expoConfig))});`);
  const executable = (name, content) => { const path = join(directory, 'bin', name); writeFileSync(path, `#!${process.execPath}\n${content}\n`); chmodSync(path, 0o755); };
  executable('git', `const fs=require('node:fs');const a=process.argv.slice(2);fs.appendFileSync(process.env.RELEASE_TEST_LOG,JSON.stringify(['git',...a])+'\\n');
    if(a[0]==='rev-parse')console.log('${SHA}');
    else if(a[0]==='status')console.log(process.env.RELEASE_TEST_DIRTY||'');
    else if(a[0]==='ls-remote'){let n=Number(fs.existsSync(process.env.RELEASE_TEST_COUNTER)?fs.readFileSync(process.env.RELEASE_TEST_COUNTER):0)+1;fs.writeFileSync(process.env.RELEASE_TEST_COUNTER,String(n));console.log((process.env.RELEASE_TEST_MASTER_MOVED&&n>1?'${'c'.repeat(40)}':'${SHA}')+'\\trefs/heads/master');}
    else if(a[0]==='merge-base'){if(process.env.RELEASE_TEST_NOT_ANCESTOR)process.exit(1);}
    else if(a[0]==='show')console.log('{"expo":{"updates":{}}}');else process.exit(2);`);
  executable('eas', `const fs=require('node:fs');const a=process.argv.slice(2);fs.appendFileSync(process.env.RELEASE_TEST_LOG,JSON.stringify(['eas',...a])+'\\n');
    if(a[0]==='--version')console.log(process.env.RELEASE_TEST_CLI_VERSION||'eas-cli/23.2.0 darwin-arm64 node-v22.1.0');
    else if(a[0]==='update:republish'){if(process.env.RELEASE_TEST_CLI_FAILED)process.exit(1);console.log('[{"group":"${PROMOTED}"}]');}else process.exit(2);`);
  const env = { ...process.env, ...envFixture(), PATH: `${join(directory, 'bin')}:${process.env.PATH}`, RUNNER_TEMP: join(directory, 'receipt'),
    RELEASE_TEST_LOG: join(directory, 'commands.jsonl'), RELEASE_TEST_COUNTER: join(directory, 'count') };
  // No developer login flags or local secrets enter fake release tests.
  for (const name of Object.keys(env)) if (/^(DEV_LOGIN|EXPO_PUBLIC_DEV_LOGIN|EXPO_PUBLIC_ALLOW_DEV_LOGIN|EAS_BUILD_PROFILE)/.test(name)) delete env[name];
  const fetcher = async () => {
    const data = evidenceFixture();
    if (existsSync(env.RELEASE_TEST_LOG) && readFileSync(env.RELEASE_TEST_LOG, 'utf8').includes('update:republish')) {
      data.updatesByGroup[0].group = PROMOTED; data.updatesByGroup[0].branch = { id: 'production-id', name: 'production' };
      if (env.RELEASE_TEST_PAYLOAD_CHANGED) { const manifest = JSON.parse(data.updatesByGroup[0].manifestFragment); manifest.launchAsset.fileSHA256 = 'changed'; data.updatesByGroup[0].manifestFragment = JSON.stringify(manifest); }
    }
    return { ok: true, json: async () => ({ data }) };
  };
  return { directory, env, fetcher, commands: () => existsSync(env.RELEASE_TEST_LOG) ? readFileSync(env.RELEASE_TEST_LOG, 'utf8').trim().split('\n').map(JSON.parse) : [], close: () => rmSync(directory, { recursive: true, force: true }) };
}

test('runner promotes the exact tested group and saves checked identities without secrets', async () => {
  const s = sandbox();
  try {
    const receipt = await promoteRelease({ env: s.env, cwd: s.directory, fetcher: s.fetcher });
    assert.equal(receipt.status, 'promoted'); assert.equal(receipt.productionGroup, PROMOTED);
    assert.equal(receipt.candidateBundleSha256, bundleIdentity(evidenceFixture().updatesByGroup[0]));
    const writes = s.commands().filter(command => command[0] === 'eas' && command[1] !== '--version');
    assert.deepEqual(writes, [['eas', 'update:republish', '--group', GROUP, '--platform', 'android', '--destination-branch', 'production', '--message', 'Promote aaaaaaa (android)', '--non-interactive', '--json']]);
    const saved = readFileSync(join(s.env.RUNNER_TEMP, 'native-release.json'), 'utf8');
    assert.ok(!saved.includes(s.env.EXPO_TOKEN) && !saved.includes(s.env.EXPO_PUBLIC_SUPABASE_KEY));
  } finally { s.close(); }
});
for (const [name, flag] of [['master moves immediately before publish', 'RELEASE_TEST_MASTER_MOVED'], ['dirty checkout', 'RELEASE_TEST_DIRTY'], ['binary source not in history', 'RELEASE_TEST_NOT_ANCESTOR'], ['CLI version changes', 'RELEASE_TEST_CLI_VERSION']]) {
  test(`runner does not write when ${name}`, async () => { const s = sandbox(); s.env[flag] = 'invalid';
    try { await assert.rejects(promoteRelease({ env: s.env, cwd: s.directory, fetcher: s.fetcher })); assert.ok(!s.commands().some(command => command.includes('update:republish'))); }
    finally { s.close(); }
  });
}
for (const flag of ['RELEASE_TEST_CLI_FAILED', 'RELEASE_TEST_PAYLOAD_CHANGED']) {
  test(`runner records ambiguous writes for ${flag}`, async () => { const s = sandbox(); s.env[flag] = 'true';
    try { await assert.rejects(promoteRelease({ env: s.env, cwd: s.directory, fetcher: s.fetcher }), /may already have succeeded/); assert.equal(JSON.parse(readFileSync(join(s.env.RUNNER_TEMP, 'native-release.json'))).status, 'unknown-after-promotion-attempt'); }
    finally { s.close(); }
  });
}

test('metadata API fails closed without disclosing API errors', async () => {
  await assert.rejects(queryEas('query {}', {}, envFixture(), async () => ({ ok: true, json: async () => ({ errors: [{ message: 'private-secret-value' }] }) })), error => !error.message.includes('private-secret-value'));
});

test('workflow permits only explicit manual promotion and preserves uncertain-write receipts', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/eas-update.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/); assert.doesNotMatch(workflow, /^  push:/m);
  assert.match(workflow, /cancel-in-progress: false/); assert.match(workflow, /environment: production/);
  assert.match(workflow, /github.ref == 'refs\/heads\/master'/); assert.match(workflow, /if: always\(\)/);
  assert.doesNotMatch(workflow, /run:.*eas update --/);
});
