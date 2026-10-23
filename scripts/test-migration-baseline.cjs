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
  assert.equal(baseline.migrations.length, 9);
  const changed = structuredClone(baseline);
  changed.migrations[0].sha256 = '0'.repeat(64);
  assert.throws(() => readBaseline(root, changed), /checksum mismatch/);
});

test('rejects duplicate migration history and conflicting local versions', () => {
  const { planUpgrade } = require('./migration-baseline.cjs');
  const baseline = { migrations: [{ file: '0001_init.sql', productionVersion: '20260101000000' }] };
  assert.throws(() => planUpgrade(baseline, [{ version: '20260101000000' }, { version: '20260101000000' }], ['0001_init.sql']), /duplicate remote versions/);
  assert.throws(() => planUpgrade(baseline, [{ version: '20260101000000' }], ['0001_init.sql', '20261022000000_first.sql', '20261022000000_second.sql']), /duplicate migration versions/);
});
