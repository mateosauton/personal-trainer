// Shared by Expo config, release preflight and the app. Keep Node APIs out of
// this module: Metro includes the same checks in native and browser bundles.
const environments = require('./environments.json');
const MOCK_URL = 'http://127.0.0.1:54321';
const MOCK_KEY = 'sb_publishable_LOCAL_TEST_FIXTURE_ONLY';
const EAS_PROFILE_ENVIRONMENTS = Object.freeze({
  development: 'development', preview: 'preview', production: 'production', 'release-test': 'production',
});
const HOSTED_ENVIRONMENTS = ['development', 'preview', 'production'];
const PURPOSES = ['development', 'test', 'distribution', 'runtime'];

// Legacy anon keys are JWTs. Decode their public claims without depending on
// Buffer/atob (availability differs between Hermes, Node and browser runtimes).
// This is a routing/privilege check, not cryptographic authentication: Supabase
// still authenticates the key and enforces RLS on every real request.
function decodeClaims(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('Invalid public Supabase key.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bits = 0;
  let value = 0;
  let decoded = '';
  for (const character of segment.replace(/-/g, '+').replace(/_/g, '/')) {
    value = (value << 6) | alphabet.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      decoded += String.fromCharCode((value >> bits) & 255);
    }
  }
  try { return JSON.parse(decoded); }
  catch { throw new Error('Invalid public Supabase key.'); }
}

function validatePublicKey(key, projectRef) {
  if (typeof key !== 'string' || key === MOCK_KEY) throw new Error('A public Supabase publishable or legacy anon key is required.');
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key)) return;
  const parts = key.split('.');
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[2])) throw new Error('Only public Supabase publishable or legacy anon keys are allowed.');
  const header = decodeClaims(parts[0]);
  const claims = decodeClaims(parts[1]);
  if (!header || header.alg !== 'HS256' || !claims || claims.role !== 'anon' || (projectRef !== null && claims.ref !== projectRef)) {
    throw new Error('Legacy public Supabase key must have the anon role and match the selected backend project.');
  }
}

function validateEnvironment(input, registry = environments) {
  const { appEnvironment, purpose } = input;
  if (!PURPOSES.includes(purpose)) throw new Error('An explicit environment validation purpose is required.');
  if (appEnvironment === 'mock') {
    if (purpose === 'distribution' || !input.allowMock || input.url !== MOCK_URL || input.key !== MOCK_KEY) {
      throw new Error('Mock environment requires the exact offline fixture in an explicit development or test context; it cannot be distributed.');
    }
    return { appEnvironment, projectRef: null, url: MOCK_URL, key: MOCK_KEY };
  }
  if (appEnvironment === 'local') {
    if (purpose === 'distribution' || !input.allowLocal || input.url !== MOCK_URL) throw new Error('Local backend requires explicit local development at http://127.0.0.1:54321; it cannot be distributed.');
    validatePublicKey(input.key, null);
    return { appEnvironment, projectRef: null, url: MOCK_URL, key: input.key };
  }
  if (!HOSTED_ENVIRONMENTS.includes(appEnvironment)) throw new Error('APP_ENV environment must explicitly select development, preview or production.');
  const projectRef = registry[appEnvironment]?.projectRef;
  if (!projectRef) throw new Error('Selected backend environment is not provisioned. Register its isolated Supabase project in config/environments.json first.');
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error('Invalid backend project reference in environment registry.');
  if (HOSTED_ENVIRONMENTS.some((name) => name !== appEnvironment && registry[name]?.projectRef === projectRef)) {
    throw new Error('Each environment must use a distinct backend project.');
  }
  const expectedUrl = `https://${projectRef}.supabase.co`;
  // Exact canonical origin comparison also rejects credentials, paths, query
  // strings, ports, lookalike domains and HTTP without relying on URL globals.
  if (input.url !== expectedUrl && input.url !== `${expectedUrl}/`) throw new Error('Supabase backend URL must exactly match the selected environment project.');
  validatePublicKey(input.key, projectRef);
  const hasDevCredentials = Boolean(input.devLoginEmail || input.devLoginPassword || input.allowDevLogin);
  if (hasDevCredentials && (purpose === 'distribution' || appEnvironment !== 'development')) {
    throw new Error('Public dev-login credentials and flags are forbidden in distributable or production/preview apps.');
  }
  return { appEnvironment, projectRef, url: expectedUrl, key: input.key };
}

function validateProcessEnvironment(env, options, registry = environments) {
  if (!env.APP_ENV || env.APP_ENV !== env.EXPO_PUBLIC_APP_ENV) throw new Error('APP_ENV and EXPO_PUBLIC_APP_ENV must be set explicitly and match.');
  if (options.expectedEnvironment && env.APP_ENV !== options.expectedEnvironment) throw new Error('APP_ENV does not match the expected deployment environment.');
  if (env.EAS_BUILD_PROFILE && EAS_PROFILE_ENVIRONMENTS[env.EAS_BUILD_PROFILE] !== env.APP_ENV) throw new Error('EAS build profile does not match the selected app environment.');
  if (env.WORKERS_CI || env.WORKERS_CI_BRANCH) {
    if (!env.WORKERS_CI_BRANCH) throw new Error('Cloudflare build branch is required.');
    const expected = env.WORKERS_CI_BRANCH === 'master' ? 'production' : 'preview';
    if (env.APP_ENV !== expected) throw new Error('Cloudflare build branch does not match the selected app environment.');
  }
  if (env.VERCEL_ENV && env.VERCEL_ENV !== env.APP_ENV) throw new Error('VERCEL_ENV does not match the selected app environment.');
  return validateEnvironment({
    appEnvironment: env.APP_ENV,
    url: env.EXPO_PUBLIC_SUPABASE_URL,
    key: env.EXPO_PUBLIC_SUPABASE_KEY,
    purpose: options.purpose,
    allowMock: options.allowMock,
    allowLocal: options.allowLocal,
    devLoginEmail: env.EXPO_PUBLIC_DEV_LOGIN_EMAIL,
    devLoginPassword: env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD,
    allowDevLogin: env.EXPO_PUBLIC_ALLOW_DEV_LOGIN,
  }, registry);
}

module.exports = { validateEnvironment, validateProcessEnvironment, MOCK_URL, MOCK_KEY, EAS_PROFILE_ENVIRONMENTS };

/** Derive an independent deployment target from direct Expo/EAS commands. */
function resolveCommandContext(argv) {
  const command = argv[2];
  // These inspect/fetch configuration only. In particular, env:exec must be
  // able to fetch EAS variables before its child export runs the strict guard.
  if (['env:pull', 'env:list', 'env:exec', 'build:view', 'update:view', 'channel:view', 'project:info', 'whoami'].includes(command)) return { readOnly: true };
  const value = (flag) => {
    if (argv.filter((arg) => arg === flag || arg.startsWith(`${flag}=`)).length > 1) throw new Error('Ambiguous repeated EAS routing flag.');
    const entry = argv.find((arg) => arg.startsWith(`${flag}=`));
    if (entry) return entry.slice(flag.length + 1);
    const index = argv.indexOf(flag);
    return index < 0 ? undefined : argv[index + 1];
  };
  if (command === 'update') {
    const channel = value('--channel');
    const environment = value('--environment');
    const expected = ({ production: 'production', 'release-test': 'production', preview: 'preview' })[channel];
    if (!expected || argv.includes('--branch') || argv.some((arg) => arg.startsWith('--branch='))) throw new Error('EAS update requires an explicit supported channel.');
    if (environment !== expected) throw new Error('EAS update channel and --environment must select the same environment.');
    return { purpose: 'distribution', expectedEnvironment: expected };
  }
  if (command === 'build' || command === 'build:inspect') {
    const longProfile = value('--profile');
    const shortProfile = value('-e');
    if (longProfile && shortProfile) throw new Error('Ambiguous repeated EAS profile flags.');
    const profile = longProfile || shortProfile || 'production';
    const expected = EAS_PROFILE_ENVIRONMENTS[profile];
    if (!expected) throw new Error('Unknown EAS build profile.');
    return { purpose: 'distribution', expectedEnvironment: expected };
  }
  const development = command === 'start' && !argv.includes('--no-dev');
  return { purpose: development ? 'development' : 'distribution', allowLocal: development, allowMock: development };
}
module.exports.resolveCommandContext = resolveCommandContext;
