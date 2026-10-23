// The supported candidate publisher. EAS config-discovery children lose the
// outer command arguments, so validate its target before starting the CLI.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { resolveCommandContext, validateProcessEnvironment } = require('../config/environment-policy.cjs');
const root = path.resolve(__dirname, '..');
const supportedFlags = new Set(['--channel', '--environment', '--platform', '--message']);

function publishUpdate(args, { env = process.env, registry, spawn = spawnSync } = {}) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!supportedFlags.has(flag) || Object.hasOwn(values, flag)) throw new Error('Use each supported candidate option exactly once: --channel, --environment, --platform, --message.');
    if (typeof value !== 'string' || !value.trim() || value.startsWith('-')) throw new Error('Every candidate option requires a nonempty explicit value.');
    values[flag] = value;
  }
  if ([...supportedFlags].some(flag => !Object.hasOwn(values, flag))) throw new Error('Candidate publishing requires --channel, --environment, --platform and --message.');
  if (values['--channel'] === 'production') throw new Error('Production updates require the manual tested-group promotion workflow.');
  if (!['preview', 'release-test'].includes(values['--channel'])) throw new Error('Candidate channel must be preview or release-test.');
  if (!['android', 'ios'].includes(values['--platform'])) throw new Error('Select one explicit candidate platform: android or ios.');
  const updateArgs = [...supportedFlags].flatMap(flag => [flag, values[flag]]);
  const context = resolveCommandContext(['node', 'eas', 'update', ...updateArgs]);
  const childEnvironment = { ...env, EXPO_NO_DOTENV: '1', TRAINER_UPDATE_APP_ENV: context.expectedEnvironment };
  validateProcessEnvironment(childEnvironment, context, registry);
  const result = spawn('npx', ['--yes', 'eas-cli@23.2.0', 'update', ...updateArgs, '--non-interactive'], {
    cwd: root, env: childEnvironment, stdio: 'inherit',
  });
  if (result.error || result.status !== 0) throw new Error('EAS update failed; inspect the candidate channel before retrying.');
  return result;
}

if (require.main === module) {
  try { publishUpdate(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { publishUpdate };
