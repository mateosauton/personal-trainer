const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');

test('refuses an upgrade without verified production version mappings', () => {
  const { planUpgrade } = require('./migration-baseline.cjs');
  assert.throws(() => planUpgrade({ migrations: [{ file: '0001_init.sql', productionVersion: null }] }, [], ['0001_init.sql']), /unverified production version/);
});

test('skips initialization and lists only new migrations for verified history', () => {
  const { planUpgrade } = require('./migration-baseline.cjs');
  const baseline = { migrations: [{ file: '0001_init.sql', productionVersion: '20260101000000' }] };
  assert.deepEqual(planUpgrade(baseline, [{ version: '20260101000000' }], ['0001_init.sql', '20261022000000_fix.sql']), ['20261022000000_fix.sql']);
  assert.deepEqual(planUpgrade(baseline, [{ version: '20260101000000' }, { version: '20261022000000' }], ['0001_init.sql', '20261022000000_fix.sql']), []);
});

test('rejects unknown history, missing baseline rows, and backdated additions', () => {
  const { planUpgrade } = require('./migration-baseline.cjs');
  const baseline = { migrations: [{ file: '0001_init.sql', productionVersion: '20260101000000' }] };
  assert.throws(() => planUpgrade(baseline, [], ['0001_init.sql']), /missing baseline version/);
  assert.throws(() => planUpgrade(baseline, [{ version: '20260101000000' }, { version: '9999' }], ['0001_init.sql']), /unknown remote version/);
  assert.throws(() => planUpgrade(baseline, [{ version: '20260101000000' }], ['0000_old.sql', '0001_init.sql']), /must follow the baseline/);
});

test('pins deployed migration bytes and rejects changed history', () => {
  const { readBaseline } = require('./migration-baseline.cjs');
  const root = path.resolve(__dirname, '..');
  const baseline = readBaseline(root);
  assert.equal(baseline.migrations.length, 18);
  const changed = structuredClone(baseline);
  changed.migrations[0].sha256 = '0'.repeat(64);
  assert.throws(() => readBaseline(root, changed), /checksum mismatch/);
});

test('reconciled production history has no pending migrations', () => {
  const { readFileSync } = require('node:fs');
  const { readBaseline, planUpgrade, migrationFiles } = require('./migration-baseline.cjs');
  const root = path.resolve(__dirname, '..');
  const baseline = readBaseline(root);
  const history = JSON.parse(readFileSync(path.join(root, 'supabase/production-history.json'), 'utf8'));
  const files = migrationFiles(root);
  assert.deepEqual(baseline.migrations.map(({ file }) => file), files);
  for (const migration of baseline.migrations) {
    assert.equal(migration.file.split('_')[0], migration.productionVersion);
  }
  assert.deepEqual(planUpgrade(baseline, history, files), []);
  assert.deepEqual(cliPending(files, history.map(({ version }) => version)), []);
});

// Same two-pointer walk as Supabase CLI findPendingMigrations (lexical versions).
function cliPending(files, remoteVersions) {
  remoteVersions = [...remoteVersions].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const local = [...files].sort((a, b) => a.split('_')[0] < b.split('_')[0] ? -1 : a.split('_')[0] > b.split('_')[0] ? 1 : 0);
  const missing = [];
  const unapplied = [];
  let i = 0;
  let j = 0;
  while (i < remoteVersions.length && j < local.length) {
    const remote = remoteVersions[i];
    const version = local[j].split('_')[0];
    if (remote === version) { i += 1; j += 1; }
    else if (remote < version) { missing.push(remote); i += 1; }
    else { unapplied.push(local[j]); j += 1; }
  }
  if (j === local.length) missing.push(...remoteVersions.slice(i));
  assert.deepEqual(missing, [], 'remote versions missing locally');
  assert.deepEqual(unapplied, [], 'local versions out of order relative to remote history');
  return local.slice(remoteVersions.length);
}

test('rejects duplicate migration history and conflicting local versions', () => {
  const { planUpgrade } = require('./migration-baseline.cjs');
  const baseline = { migrations: [{ file: '0001_init.sql', productionVersion: '20260101000000' }] };
  assert.throws(() => planUpgrade(baseline, [{ version: '20260101000000' }, { version: '20260101000000' }], ['0001_init.sql']), /duplicate remote versions/);
  assert.throws(() => planUpgrade(baseline, [{ version: '20260101000000' }], ['0001_init.sql', '20261022000000_first.sql', '20261022000000_second.sql']), /duplicate migration versions/);
});
