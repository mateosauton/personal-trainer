const path = require('node:path');
const { spawnSync } = require('node:child_process');
const registry = require('../config/environments.json');

function buildCheckPlan(cwd, inheritedEnvironment) {
  if (['WORKERS_CI', 'WORKERS_CI_BRANCH', 'VERCEL_ENV', 'EAS_BUILD_PROFILE'].some((name) => inheritedEnvironment[name])) {
    throw new Error('The synthetic bundle check cannot run in a hosted deployment context.');
  }
  const env = Object.fromEntries(Object.entries(inheritedEnvironment).filter(([name]) => !name.startsWith('EXPO_PUBLIC_')));
  Object.assign(env, {
    APP_ENV: 'production',
    EXPO_PUBLIC_APP_ENV: 'production',
    EXPO_PUBLIC_SUPABASE_URL: `https://${registry.production.projectRef}.supabase.co`,
    EXPO_PUBLIC_SUPABASE_KEY: 'sb_publishable_BUNDLE_CHECK_FIXTURE_ONLY',
    EXPO_NO_DOTENV: '1',
    CI: '1',
  });
  return {
    command: process.execPath,
    args: [path.join(cwd, 'node_modules/expo/bin/cli'), 'export', '--platform', 'web', '--output-dir', '.expo/web-check'],
    env,
  };
}

if (require.main === module) {
  try {
    const { command, args, env } = buildCheckPlan(process.cwd(), process.env);
    console.log('Checking Metro with synthetic public configuration; output is .expo/web-check and must not be deployed.');
    const result = spawnSync(command, args, { cwd: process.cwd(), env, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(`Bundle check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
module.exports = { buildCheckPlan };
