// Local Supabase only. No login, link, remote project, or arbitrary CLI flags.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync, readdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { validateEnvironment } = require('../config/environment-policy.cjs');

const repository = path.resolve(__dirname, '..');
const cliVersion = '2.120.0';
const localApi = 'http://127.0.0.1:54321';
const container = 'supabase_db_office-gym-trainer-local';
const accounts = ['trainer-a@example.test', 'trainer-b@example.test'];
const localPassword = 'local-test-password-Only1!';

function parseCommand(args) {
  if (args[0] === 'reset' && args.length === 1) throw new Error('reset requires --confirm-local-reset; this deletes this local stack\'s data');
  if (args.length === 2 && args[0] === 'reset' && args[1] === '--confirm-local-reset') return 'reset';
  assert(args.length === 1 && ['start', 'stop', 'env', 'seed', 'test'].includes(args[0]), 'usage: node scripts/dev-db.cjs start|stop|env|seed|test|reset --confirm-local-reset');
  return args[0];
}

function localProcessEnvironment(source = process.env) {
  assert(!source.DOCKER_HOST || source.DOCKER_HOST.startsWith('unix://') || source.DOCKER_HOST.startsWith('npipe://'), 'local Docker socket required; remote Docker hosts are not supported');
  return Object.fromEntries(Object.entries(source).filter(([name]) => !/^(SUPABASE_|EXPO_PUBLIC_SUPABASE_)/.test(name)));
}

function resolvedDockerEnvironment(source = process.env, inspectContext) {
  const env = localProcessEnvironment(source);
  const inspect = inspectContext || ((name) => {
    const args = ['context', 'inspect', ...(name ? [name] : []), '--format', '{{.Endpoints.docker.Host}}'];
    const result = spawnSync('docker', args, { encoding: 'utf8', env, timeout: 15000 });
    assert.equal(result.status, 0, 'cannot inspect the effective local Docker context');
    return result.stdout.trim();
  });
  // DOCKER_CONTEXT overrides DOCKER_HOST. With neither set, the selected
  // context in Docker's config can still name a remote host.
  const endpoint = source.DOCKER_CONTEXT ? inspect(source.DOCKER_CONTEXT) : source.DOCKER_HOST || inspect();
  assert(typeof endpoint === 'string' && /^(unix|npipe):\/\//.test(endpoint), 'local Docker socket required; the effective Docker context points to a remote or unsupported daemon');
  delete env.DOCKER_CONTEXT;
  env.DOCKER_HOST = endpoint;
  return env;
}

function assertLocalStatus(status) {
  assert.equal(status.API_URL, localApi, 'expected exact local API http://127.0.0.1:54321');
  const db = new URL(status.DB_URL);
  assert(['postgres:', 'postgresql:'].includes(db.protocol) && db.hostname === '127.0.0.1' && db.port === '54322' && db.pathname === '/postgres', 'expected local database 127.0.0.1:54322/postgres');
  return status;
}

function clientEnvironment(status) {
  assertLocalStatus(status);
  const key = status.PUBLISHABLE_KEY || status.ANON_KEY;
  assert(typeof key === 'string' && /^[a-zA-Z0-9._-]+$/.test(key) && !key.startsWith('sb_secret_') && key !== status.SERVICE_ROLE_KEY, 'local public key missing or unsafe');
  validateEnvironment({ appEnvironment: 'local', purpose: 'development', allowLocal: true, url: localApi, key });
  return [
    '# Generated for the disposable local Supabase stack. Never use for distribution.',
    'APP_ENV=local',
    'EXPO_PUBLIC_APP_ENV=local',
    `EXPO_PUBLIC_SUPABASE_URL=${localApi}`,
    `EXPO_PUBLIC_SUPABASE_KEY=${key}`,
    'EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED=false',
    '',
  ].join('\n');
}

function writeClientEnvironment(status, root = repository) {
  const file = path.join(root, '.env.local');
  try {
    writeFileSync(file, clientEnvironment(status), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('.env.local already exists; preserve or move it before generating local settings');
    throw error;
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repository, encoding: 'utf8', env: resolvedDockerEnvironment(),
    timeout: 15 * 60 * 1000, maxBuffer: 10 * 1024 * 1024, ...options,
  });
  // CLI start/status output contains admin keys. Never forward it into logs.
  assert(result.status === 0, `${command} ${args.slice(0, 3).join(' ')} failed. Verify Docker is running and inspect the local service with the pinned CLI. No hosted fallback was attempted.`);
  return result.stdout;
}

function supabase(args) {
  return run('npx', ['--yes', `supabase@${cliVersion}`, ...args, '--workdir', repository]);
}

function localStatus() {
  return assertLocalStatus(JSON.parse(supabase(['status', '--output', 'json'])));
}

async function seedAccounts(status, request = fetch) {
  assertLocalStatus(status);
  const admin = status.SECRET_KEY || status.SERVICE_ROLE_KEY;
  assert(typeof admin === 'string' && admin.length > 0, 'local Auth admin key missing');
  for (const email of accounts) {
    const response = await request(`${localApi}/auth/v1/admin/users`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { apikey: admin, Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: localPassword, email_confirm: true }),
    });
    const body = await response.json();
    assert(response.ok || ['email_exists', 'user_already_exists'].includes(body.code), `local Auth seed failed for ${email}; no hosted fallback was attempted`);
  }
}

function databaseTestCommands(root = repository) {
  const directory = path.join(root, 'supabase/tests');
  const files = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  assert(files.length > 0, 'local database tests missing');
  return files.map((name) => ({
    name,
    args: ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    input: readFileSync(path.join(directory, name), 'utf8'),
  }));
}

async function main(args) {
  const command = parseCommand(args);
  if (command === 'start') {
    supabase(['start']);
    localStatus();
    console.log('Local Supabase started. Auth/API http://127.0.0.1:54321, Studio :54323, email inbox :54324.');
  } else if (command === 'stop') {
    supabase(['stop', '--project-id', 'office-gym-trainer-local']);
    console.log('Local Supabase stopped; local volumes retained.');
  } else if (command === 'reset') {
    supabase(['db', 'reset', '--local', '--no-seed', '--yes']);
    console.log('Disposable local database reset from repository migrations. Run seed again for synthetic accounts.');
  } else if (command === 'env') {
    writeClientEnvironment(localStatus());
    console.log('Wrote ignored .env.local with only the local public client key.');
  } else if (command === 'seed') {
    await seedAccounts(localStatus());
    console.log(`Local synthetic accounts ready: ${accounts.join(', ')}. Password is documented in docs/ENVIRONMENTS.md.`);
  } else {
    localStatus();
    for (const { name, args: testArgs, input } of databaseTestCommands()) {
      run('docker', testArgs, { input });
      console.log(`PASS local Supabase ${name}`);
    }
  }
}

if (require.main === module) main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = { parseCommand, localProcessEnvironment, resolvedDockerEnvironment, assertLocalStatus, clientEnvironment, writeClientEnvironment, seedAccounts, databaseTestCommands };
