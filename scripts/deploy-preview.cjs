const { spawnSync } = require('node:child_process');
const environments = require('../config/environments.json');
const { validateProcessEnvironment } = require('../config/environment-policy.cjs');

function deployPreview(args = [], { env = process.env, registry = environments, spawn = spawnSync, log = console.log } = {}) {
  if (args.length) throw new Error('Cloudflare preview accepts no command-line overrides.');
  if (env.WORKERS_CI !== '1' || env.VERCEL_ENV || env.EAS_BUILD_PROFILE) {
    throw new Error('Preview command requires Cloudflare Workers Builds.');
  }
  const branch = env.WORKERS_CI_BRANCH;
  if (typeof branch !== 'string' || !branch.trim() || ['master', 'gh-pages', 'cdn'].includes(branch)) {
    throw new Error('Preview command requires an allowed non-production branch.');
  }
  for (const name of ['APP_ENV', 'EXPO_PUBLIC_APP_ENV']) {
    if (env[name] !== undefined && env[name] !== 'preview') throw new Error('Preview command cannot select another app environment.');
  }
  if (!registry?.preview || !Object.hasOwn(registry.preview, 'projectRef')) throw new Error('Invalid preview environment registry.');
  // Only an explicit null is a deliberate block. Do not turn broken credentials,
  // malformed configuration or failed uploads into successful skips.
  if (registry.preview.projectRef === null) {
    log('SKIP_PREVIEW: isolated backend not registered; no build or upload performed.');
    return { skipped: true };
  }
  validateProcessEnvironment(env, { purpose: 'distribution', expectedEnvironment: 'preview' }, registry);
  const result = spawn('npx', ['--yes', 'wrangler', 'versions', 'upload'], {
    env: { ...env, EXPO_NO_DOTENV: '1' }, stdio: 'inherit', shell: false,
  });
  if (result.error || result.status !== 0) throw new Error('Preview upload failed.');
  return { skipped: false };
}

if (require.main === module) {
  try { deployPreview(process.argv.slice(2)); }
  catch (error) { console.error(`Cloudflare preview failed: ${error.message}`); process.exitCode = 1; }
}
module.exports = { deployPreview };
