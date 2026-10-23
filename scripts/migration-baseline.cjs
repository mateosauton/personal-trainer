// Read-only planning. This tool never connects to or modifies a database.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

const repository = path.resolve(__dirname, '..');
const migrationFiles = (root = repository) => readdirSync(path.join(root, 'supabase/migrations'))
  .filter((file) => file.endsWith('.sql')).sort();

function readBaseline(root = repository, supplied) {
  const baseline = supplied ?? JSON.parse(readFileSync(path.join(root, 'supabase/migration-baseline.json'), 'utf8'));
  assert.equal(baseline.format, 1, 'unsupported baseline format');
  assert(baseline.migrations.length > 0, 'empty baseline');
  const names = baseline.migrations.map(({ file }) => file);
  assert.equal(new Set(names).size, names.length, 'duplicate baseline files');
  assert.deepEqual(names, [...names].sort(), 'baseline files must be ordered');
  for (const { file, sha256 } of baseline.migrations) {
    assert(/^\d+_[a-z0-9_]+\.sql$/.test(file), `invalid migration filename: ${file}`);
    const bytes = readFileSync(path.join(root, 'supabase/migrations', file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256, `checksum mismatch: ${file}`);
  }
  return baseline;
}

function planUpgrade(baseline, history, files) {
  const versions = baseline.migrations.map(({ file, productionVersion }) => {
    assert(typeof productionVersion === 'string' && /^\d+$/.test(productionVersion), `unverified production version: ${file}`);
    return productionVersion;
  });
  assert.equal(new Set(versions).size, versions.length, 'duplicate baseline production versions');
  const remote = history.map(({ version }) => {
    assert(typeof version === 'string' && /^\d+$/.test(version), 'history versions must be digit strings');
    return version;
  });
  assert.equal(new Set(remote).size, remote.length, 'duplicate remote versions');
  for (const version of versions) assert(remote.includes(version), `missing baseline version: ${version}`);
  const baselineFiles = new Set(baseline.migrations.map(({ file }) => file));
  const boundary = baseline.migrations.at(-1).file;
  const additions = files.filter((file) => !baselineFiles.has(file));
  for (const file of additions) assert(file > boundary, `new migrations must follow the baseline: ${file}`);
  const localVersions = additions.map((file) => file.split('_')[0]);
  const recognized = new Set([...versions, ...localVersions]);
  assert.equal(recognized.size, versions.length + additions.length, 'duplicate migration versions');
  for (const version of remote) assert(recognized.has(version), `unknown remote version: ${version}`);
  return additions.filter((file) => !remote.includes(file.split('_')[0]));
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const baseline = readBaseline();
    if (args.length === 0) {
      console.log(`PASS ${baseline.migrations.length} deployed-source migration checksums`);
      console.log('This verifies repository bytes only. Use --history FILE for a read-only upgrade plan.');
    } else {
      assert(args.length === 2 && args[0] === '--history', 'usage: node scripts/migration-baseline.cjs [--history FILE]');
      const history = JSON.parse(readFileSync(args[1], 'utf8'));
      assert(Array.isArray(history), 'history must be a JSON array of {version,name} rows');
      const pending = planUpgrade(baseline, history, migrationFiles());
      console.log(JSON.stringify({ pending, baselineReplayed: false }, null, 2));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { readBaseline, planUpgrade, migrationFiles };
