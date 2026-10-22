import { recoveryKeys, readRecoveryData, QueueDataRecovery } from '@/lib/session/recovery-data';

const owner = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const key = `office-gym.session-outbox.v2.${owner}`;
const operation = { id: 'set:saved', kind: 'set', payload: { sessionId: 'saved', reps: 8 } };
const disk = () => {
  const values = new Map<string, string>();
  return { values, getItem: async (name: string) => values.get(name) ?? null,
    setItem: jest.fn(async (name: string, raw: string) => { values.set(name, raw); }) };
};

it('exports exact account-owned bytes even when a queue or backup is malformed', async () => {
  const storage = disk();
  storage.values.set(key, '{broken');
  storage.values.set(`office-gym.recovery-backups.v1.${owner}`, 'broken backup');
  storage.values.set(`office-gym.session-outbox.v2.${other}`, 'private B');
  const exported = await readRecoveryData(storage, owner);
  expect(exported.records[key]).toBe('{broken');
  expect(exported.records[`office-gym.recovery-backups.v1.${owner}`]).toBe('broken backup');
  expect(JSON.stringify(exported)).not.toContain('private B');
  expect(recoveryKeys(owner)).toContain(`office-gym.profile.${owner}`);
});

it('repairs readable queue entries only after preserving the complete original', async () => {
  const storage = disk();
  const raw = JSON.stringify([operation, null, { kind: 'unknown' }]);
  storage.values.set(key, raw);
  const recovery = new QueueDataRecovery(storage, owner);
  const [review] = await recovery.inspect();
  expect(review.recoverable).toBe(1);
  expect(review.suggested).toBe(JSON.stringify([operation], null, 2));
  await recovery.repair(review, review.suggested!);
  expect(JSON.parse(storage.values.get(key)!)).toEqual([operation]);
  expect(JSON.parse(storage.values.get(`office-gym.recovery-backups.v1.${owner}`)!)[0].raw).toBe(raw);
});

it('allows syntax repair and preserves the unparsable original for export', async () => {
  const storage = disk();
  const raw = JSON.stringify([operation]).slice(0, -1);
  storage.values.set(`${key}.rejected`, raw);
  const recovery = new QueueDataRecovery(storage, owner);
  const [review] = await recovery.inspect();
  const repaired = [{ operation, code: 'PT409', resolved: false }];
  await recovery.repair(review, JSON.stringify(repaired));
  expect(JSON.parse(storage.values.get(`${key}.rejected`)!)).toEqual(repaired);
  expect((await readRecoveryData(storage, owner)).records[`office-gym.recovery-backups.v1.${owner}`]).toContain('raw');
});

it('refuses a repair that drops readable operations or changes a newer capture', async () => {
  const storage = disk();
  storage.values.set(key, JSON.stringify([operation, null]));
  const recovery = new QueueDataRecovery(storage, owner);
  const [review] = await recovery.inspect();
  await expect(recovery.repair(review, '[]')).rejects.toThrow('readable');
  storage.values.set(key, JSON.stringify([operation, { ...operation, id: 'new' }]));
  await expect(recovery.repair(review, JSON.stringify([operation]))).rejects.toThrow('changed');
});

it('never replaces damaged source data when the backup cannot be written', async () => {
  const storage = disk();
  const raw = JSON.stringify([operation, null]);
  storage.values.set(key, raw);
  const recovery = new QueueDataRecovery(storage, owner);
  const [review] = await recovery.inspect();
  storage.setItem.mockRejectedValueOnce(new Error('disk full'));
  await expect(recovery.repair(review, review.suggested!)).rejects.toThrow('disk full');
  expect(storage.values.get(key)).toBe(raw);
});

it('preserves an existing malformed backup inside the next valid backup envelope', async () => {
  const storage = disk();
  storage.values.set(key, '[null]');
  storage.values.set(`office-gym.recovery-backups.v1.${owner}`, '{original backup');
  const recovery = new QueueDataRecovery(storage, owner);
  const [review] = await recovery.inspect();
  await recovery.repair(review, '[]');
  const backup = JSON.parse(storage.values.get(`office-gym.recovery-backups.v1.${owner}`)!);
  expect(backup[0].raw).toBe('{original backup');
  expect(backup[1].raw).toBe('[null]');
});
