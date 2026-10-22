const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvironment, validateProcessEnvironment, MOCK_URL, MOCK_KEY } = require('./environment-policy.cjs');

const production = 'asbudyijvunpnhrhsubm';
const development = 'devprojectabcdefghij';
const preview = 'previewprojectabcdef';
const registry = { development: { projectRef: development }, preview: { projectRef: preview }, production: { projectRef: production } };
const key = 'sb_publishable_example_public_key_for_checks';
const input = (appEnvironment = 'production', extra = {}) => ({ appEnvironment, url: `https://${registry[appEnvironment]?.projectRef}.supabase.co`, key, purpose: 'distribution', ...extra });
const processInput = (appEnvironment = 'production', extra = {}) => ({ APP_ENV: appEnvironment, EXPO_PUBLIC_APP_ENV: appEnvironment, EXPO_PUBLIC_SUPABASE_URL: input(appEnvironment).url, EXPO_PUBLIC_SUPABASE_KEY: key, ...extra });
const jwt = (role = 'anon', ref = production) => [ { alg: 'HS256', typ: 'JWT' }, { role, ref } ].map((value) => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.validSyntheticSignature';

test('accepts the explicitly mapped hosted environment and canonicalizes its URL', () => {
  for (const environment of ['development', 'preview', 'production']) {
    assert.deepEqual(validateEnvironment(input(environment, { url: input(environment).url + '/' }), registry), { appEnvironment: environment, projectRef: registry[environment].projectRef, url: input(environment).url, key });
  }
});

test('rejects missing, unknown and unprovisioned environments', () => {
  for (const environment of ['', 'staging', 'prod']) assert.throws(() => validateEnvironment(input(environment), registry), /environment/i);
  assert.throws(() => validateEnvironment({ ...input(), appEnvironment: undefined }, registry), /environment/i);
  for (const environment of ['development', 'preview']) assert.throws(() => validateEnvironment(input(environment)), /not provisioned/i);
});

test('rejects cross-environment backends and duplicate backend mappings', () => {
  for (const from of ['development', 'preview', 'production']) for (const to of ['development', 'preview', 'production']) if (from !== to) {
    assert.throws(() => validateEnvironment(input(from, { url: input(to).url }), registry), /backend/i);
  }
  assert.throws(() => validateEnvironment(input('development'), { ...registry, development: { projectRef: production } }), /distinct/i);
});

test('rejects noncanonical and lookalike backend addresses', () => {
  for (const url of [undefined, '', 'not-a-url', `http://${production}.supabase.co`, `https://${production}.supabase.co.attacker.test`, `https://attacker@${production}.supabase.co`, `https://${production}.supabase.co:8443`, `https://${production}.supabase.co/rest/v1`, `https://${production}.supabase.co?other=true`, `https://${production}.supabase.co#other`, 'http://127.0.0.1:54321']) {
    assert.throws(() => validateEnvironment(input('production', { url }), registry), /backend|URL/i);
  }
});

test('accepts matching legacy anon JWTs while rejecting privileged and other-project keys', () => {
  assert.equal(validateEnvironment(input('production', { key: jwt() }), registry).key, jwt());
  for (const invalid of [undefined, '', 'invalid', 'sb_secret_do_not_expose', jwt('service_role'), jwt('authenticated'), jwt('anon', development), MOCK_KEY, 'sb_publishable_short']) {
    assert.throws(() => validateEnvironment(input('production', { key: invalid }), registry), /public|key/i);
  }
});

test('allows only the exact offline fixture in an explicit nondistribution mock context', () => {
  const mock = { appEnvironment: 'mock', url: MOCK_URL, key: MOCK_KEY, purpose: 'test', allowMock: true };
  assert.equal(validateEnvironment(mock).projectRef, null);
  for (const patch of [{ allowMock: false }, { purpose: 'distribution' }, { url: 'http://localhost:54321' }, { url: 'http://127.0.0.1:54322' }, { url: input().url }, { key }]) {
    assert.throws(() => validateEnvironment({ ...mock, ...patch }), /mock|fixture/i);
  }
});

test('forbids public dev credentials and dev-login flags in every distributable environment', () => {
  for (const environment of ['development', 'preview', 'production']) for (const field of ['devLoginEmail', 'devLoginPassword', 'allowDevLogin']) {
    assert.throws(() => validateEnvironment(input(environment, { [field]: 'set' }), registry), /dev.login|credentials/i);
  }
  assert.doesNotThrow(() => validateEnvironment(input('development', { purpose: 'development', devLoginEmail: 'test@example.invalid' }), registry));
  assert.throws(() => validateEnvironment(input('production', { purpose: 'development', devLoginPassword: 'private' }), registry), /dev.login|credentials/i);
});

test('requires build and public environment markers to match', () => {
  assert.equal(validateProcessEnvironment(processInput(), { purpose: 'distribution' }, registry).projectRef, production);
  for (const patch of [{ APP_ENV: undefined }, { EXPO_PUBLIC_APP_ENV: undefined }, { APP_ENV: 'preview' }]) assert.throws(() => validateProcessEnvironment(processInput('production', patch), { purpose: 'distribution' }, registry), /APP_ENV|environment/i);
});

test('requires requested target and EAS profile identity to match markers', () => {
  for (const profile of ['production', 'release-test']) assert.doesNotThrow(() => validateProcessEnvironment(processInput('production', { EAS_BUILD_PROFILE: profile }), { purpose: 'distribution', expectedEnvironment: 'production' }, registry));
  for (const [environment, profile] of [['production', 'development'], ['production', 'preview'], ['preview', 'production'], ['development', 'release-test'], ['production', 'unknown']]) assert.throws(() => validateProcessEnvironment(processInput(environment, { EAS_BUILD_PROFILE: profile }), { purpose: 'distribution' }, registry), /profile|environment/i);
  assert.throws(() => validateProcessEnvironment(processInput(), { purpose: 'distribution', expectedEnvironment: 'preview' }, registry), /expected|environment/i);
});

test('deployment provider environment cannot be relabeled as production', () => {
  assert.throws(() => validateProcessEnvironment(processInput('production', { VERCEL_ENV: 'preview' }), { purpose: 'distribution' }, registry), /VERCEL_ENV|environment/i);
  assert.doesNotThrow(() => validateProcessEnvironment(processInput('production', { VERCEL_ENV: 'production' }), { purpose: 'distribution' }, registry));
});

test('does not expose provided keys or credentials in errors', () => {
  const secret = 'sb_secret_sensitive-value';
  try { validateEnvironment(input('production', { key: secret }), registry); assert.fail('expected rejection'); }
  catch (error) { assert.equal(error.message.includes(secret), false); }
});

test('allows genuine local Supabase only in explicit local development contexts', () => {
  const local = { appEnvironment: 'local', purpose: 'development', url: MOCK_URL, key, allowLocal: true };
  assert.equal(validateEnvironment(local).projectRef, null);
  assert.doesNotThrow(() => validateEnvironment({ ...local, key: jwt('anon', undefined) }));
  for (const patch of [{ purpose: 'distribution' }, { allowLocal: false }, { key: MOCK_KEY }, { key: jwt('service_role') }, { url: input().url }, { url: 'http://localhost:54321' }]) {
    assert.throws(() => validateEnvironment({ ...local, ...patch }), /local|key/i);
  }
});

test('Cloudflare branch context requires production only on master', () => {
  assert.doesNotThrow(() => validateProcessEnvironment(processInput('production', { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'master' }), { purpose: 'distribution' }, registry));
  assert.throws(() => validateProcessEnvironment(processInput('production', { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'feature' }), { purpose: 'distribution' }, registry), /Cloudflare|environment/i);
  assert.throws(() => validateProcessEnvironment(processInput('preview', { WORKERS_CI: '1', WORKERS_CI_BRANCH: 'master' }), { purpose: 'distribution' }, registry), /Cloudflare|environment/i);
  assert.throws(() => validateProcessEnvironment(processInput('production', { WORKERS_CI: '1' }), { purpose: 'distribution' }, registry), /Cloudflare|branch/i);
});
