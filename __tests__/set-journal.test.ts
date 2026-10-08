import { SetJournal, type JournalWrite } from '@/lib/session/set-journal';
import type { SetLog } from '@/lib/types';
const owner = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const item = '33333333-3333-4333-8333-333333333333';
const origin = '44444444-4444-4444-8444-444444444444';
const freshOrigin = '55555555-5555-4555-8555-555555555555';
const event = '2026-10-06T10:00:00.000Z';
const set = (reps = 8): SetLog => ({
  plan_item_id: item,
  exercise_id: 'press',
  set_index: 1,
  reps,
  weight_kg: 60,
  is_bodyweight: false,
  added_load_kg: 0,
  rpe: null,
});
const disk = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
};
const make = (
  storage: ReturnType<typeof disk>,
  account = owner,
  uuid = () => origin,
) => new SetJournal(storage, account, uuid, () => event);

it('persists exact revision and event time before enqueue and reconstructs interrupted enqueue', async () => {
  const storage = disk(),
    journal = make(storage);
  await expect(
    journal.save(session, set(), async () => {
      throw new Error('queue disk full');
    }),
  ).rejects.toThrow('queue disk full');
  const pending = await make(storage).pending();
  expect(pending[0]).toMatchObject({
    sessionId: session,
    set: set(),
    origin,
    revision: 1,
    expectedVersion: 0,
    eventAt: event,
  });
  const enqueue = jest.fn(async () => {});
  await make(storage).recover(enqueue);
  expect(enqueue).toHaveBeenCalledWith(pending[0]);
  expect(await make(storage).pending()).toEqual(pending);
});
it('allocates one origin and increasing revisions across journal instances', async () => {
  const storage = disk();
  const uuid = jest.fn(() => origin);
  const a = make(storage, owner, uuid),
    b = make(storage, owner, uuid);
  const writes = await Promise.all([
    a.save(session, set(), async () => {}),
    b.save(session, set(12), async () => {}),
  ]);
  expect(writes.map((w) => w.revision)).toEqual([1, 2]);
  expect(uuid).toHaveBeenCalledTimes(1);
  expect((await a.pending())[0].set.reps).toBe(12);
});
it('keeps the newer correction when an older acknowledgement arrives', async () => {
  const storage = disk(),
    journal = make(storage);
  const old = await journal.save(session, set(), async () => {});
  const corrected = await journal.save(session, set(12), async () => {});
  await journal.acknowledge(old, { status: 'applied', serverVersion: 1 });
  expect(await make(storage).pending()).toEqual([corrected]);
  await journal.acknowledge(corrected, { status: 'applied', serverVersion: 2 });
  expect(await make(storage).pending()).toEqual([]);
  const reverted = await journal.save(session, set(), async () => {});
  expect(reverted).toMatchObject({
    revision: 3,
    expectedVersion: 2,
    set: set(),
  });
});
it('blocks conflicts across restart and never re-enqueues them on normal recovery', async () => {
  const storage = disk(),
    journal = make(storage);
  const write = await journal.save(session, set(), async () => {});
  await journal.block(write, 'PT409');
  const enqueue = jest.fn(async () => {});
  await make(storage).recover(enqueue);
  expect(enqueue).not.toHaveBeenCalled();
  expect(await make(storage).blocked()).toEqual([{ write, code: 'PT409' }]);
});
it('resolves against the displayed baseline with a new origin and preserves the rejected value', async () => {
  const storage = disk(),
    journal = make(storage, owner, () => freshOrigin);
  const write = await make(storage).save(session, set(), async () => {});
  await journal.block(write, 'PT409');
  const resolved = await journal.resolve(
    write,
    set(12),
    7,
    event,
    async () => {},
  );
  expect(resolved).toMatchObject({
    origin: freshOrigin,
    revision: 2,
    expectedVersion: 7,
    set: set(12),
  });
  expect((await journal.recoveryCopies())[0]).toEqual({ write, code: 'PT409' });
  expect((await journal.save(session, set(10), async () => {})).origin).toBe(
    freshOrigin,
  );
});
it('rejects a stale conflict choice after another local correction', async () => {
  const storage = disk(),
    journal = make(storage);
  const write = await journal.save(session, set(), async () => {});
  await journal.block(write, 'PT409');
  const correction = await journal.save(session, set(12), async () => {});
  await expect(
    journal.resolve(write, set(), 7, event, async () => {}),
  ).rejects.toThrow('changed');
  expect(await journal.pending()).toEqual([correction]);
});
it('does not silently adopt a remote version from a superseded acknowledgement', async () => {
  const journal = make(disk());
  const write = await journal.save(session, set(), async () => {});
  await journal.acknowledge(write, {
    status: 'superseded',
    serverVersion: 100,
  });
  expect(
    (await journal.save(session, set(12), async () => {})).expectedVersion,
  ).toBe(0);
});
it('preserves unreadable or foreign-account data without replacing it', async () => {
  const storage = disk(),
    journal = make(storage);
  await journal.save(session, set(), async () => {});
  const key = [...storage.values.keys()][0];
  const raw = storage.values.get(key)!;
  const invalid = JSON.parse(raw);
  invalid.ownerId = freshOrigin;
  for (const bad of ['{bad', JSON.stringify(invalid)]) {
    storage.values.set(key, bad);
    storage.setItem.mockClear();
    await expect(journal.save(session, set(), async () => {})).rejects.toThrow(
      'preserved',
    );
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.values.get(key)).toBe(bad);
  }
});
it('never enqueues a set if journal storage fails', async () => {
  const storage = disk();
  storage.setItem.mockRejectedValue(new Error('disk full'));
  const enqueue = jest.fn(async () => {});
  await expect(make(storage).save(session, set(), enqueue)).rejects.toThrow(
    'disk full',
  );
  expect(enqueue).not.toHaveBeenCalled();
});
it('does not mix accounts and canonicalizes UUID identities', async () => {
  const storage = disk();
  await make(storage).save(session, set(), async () => {});
  expect(await make(storage, freshOrigin).pending()).toEqual([]);
  const upper = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
  const journal = make(storage);
  const one = await journal.save(upper, set(), async () => {});
  const two = await journal.save(upper.toLowerCase(), set(12), async () => {});
  expect(two.revision).toBe(one.revision + 1);
});
it('rejects invalid payloads, versions, event times and acknowledgements without altering data', async () => {
  const storage = disk(),
    journal = make(storage);
  for (const invalid of [
    { ...set(), reps: 1.5 },
    { ...set(), weight_kg: NaN },
    { ...set(), plan_item_id: 'bad' },
  ])
    await expect(
      journal.save(session, invalid, async () => {}),
    ).rejects.toThrow();
  expect(storage.values.size).toBe(0);
  const write = await journal.save(session, set(), async () => {});
  await expect(
    journal.acknowledge(write, { status: 'applied', serverVersion: 0 }),
  ).rejects.toThrow();
  await journal.block(write, 'PT409');
  await expect(
    journal.resolve(write, set(), 1.5, event, async () => {}),
  ).rejects.toThrow();
  await expect(
    journal.resolve(write, set(), 1, 'bad date', async () => {}),
  ).rejects.toThrow();
  expect(await journal.blocked()).toEqual([{ write, code: 'PT409' }]);
});

it('keeps replay recoverable if the acknowledgement cannot be persisted', async () => {
  const storage = disk(),
    journal = make(storage);
  const write = await journal.save(session, set(), async () => {});
  storage.setItem.mockRejectedValueOnce(new Error('disk full'));
  await expect(
    journal.acknowledge(write, { status: 'applied', serverVersion: 1 }),
  ).rejects.toThrow('disk full');
  expect(await make(storage).pending()).toEqual([write]);
  await journal.acknowledge(write, { status: 'duplicate', serverVersion: 1 });
  expect(await make(storage).pending()).toEqual([]);
});
it('retains the explicit conflict choice when its enqueue is interrupted', async () => {
  const storage = disk(),
    journal = make(storage, owner, () => freshOrigin);
  const write = await make(storage).save(session, set(), async () => {});
  await journal.block(write, 'PT409');
  await expect(
    journal.resolve(write, set(12), 5, event, async () => {
      throw new Error('enqueue failed');
    }),
  ).rejects.toThrow('enqueue failed');
  const replay = await make(storage).pending();
  expect(replay[0]).toMatchObject({
    origin: freshOrigin,
    expectedVersion: 5,
    set: set(12),
  });
  expect((await journal.recoveryCopies())[0]).toEqual({ write, code: 'PT409' });
});
it('preserves the old rejection when the user edits a blocked set', async () => {
  const journal = make(disk());
  const write = await journal.save(session, set(), async () => {});
  await journal.block(write, 'PT409');
  const edit = await journal.save(session, set(12), async () => {});
  expect(edit).toMatchObject({ revision: 2, expectedVersion: 0 });
  expect(await journal.recoveryCopies()).toEqual([{ write, code: 'PT409' }]);
});
it('releases the shared lock after an enqueue failure', async () => {
  const storage = disk();
  await expect(
    make(storage).save(session, set(), async () => {
      throw new Error('failed');
    }),
  ).rejects.toThrow('failed');
  expect(
    (await make(storage).save(session, set(12), async () => {})).revision,
  ).toBe(2);
});
it('rejects a revision overflow and leaves the original record untouched', async () => {
  const storage = disk(),
    journal = make(storage);
  await journal.save(session, set(), async () => {});
  const key = [...storage.values.keys()][0],
    raw = JSON.parse(storage.values.get(key)!);
  raw.entries[0].write.revision = Number.MAX_SAFE_INTEGER;
  const preserved = JSON.stringify(raw);
  storage.values.set(key, preserved);
  const enqueue = jest.fn(async () => {});
  await expect(journal.save(session, set(12), enqueue)).rejects.toThrow(
    'limit',
  );
  expect(enqueue).not.toHaveBeenCalled();
  expect(storage.values.get(key)).toBe(preserved);
});
it('captures payload before another caller can mutate its input', async () => {
  const storage = disk(),
    journal = make(storage);
  const mutable = set();
  const saving = journal.save(session, mutable, async () => {});
  mutable.reps = 12;
  expect((await saving).set.reps).toBe(8);
  expect((await journal.pending())[0].set.reps).toBe(8);
});
it('preserves the original completion event when correcting a set later', async () => {
  const storage = disk();
  let clock = event;
  const journal = new SetJournal(
    storage,
    owner,
    () => origin,
    () => clock,
  );
  const first = await journal.save(session, set(), async () => {});
  clock = '2026-10-06T10:15:00.000Z';
  const corrected = await journal.save(session, set(12), async () => {});
  expect(corrected.eventAt).toBe(first.eventAt);
});

const legacy = () => ({ id: `set:${session}:${item}:1`, sessionId: session, set: set() });
it('imports an explicit legacy choice against its displayed baseline without fabricating legacy metadata', async () => {
  const storage = disk();
  const journal = make(storage, owner, () => freshOrigin);
  const captured = legacy();
  const server = { set: set(12), serverVersion: 4, eventAt: '2026-10-06T11:00:00Z' };
  const publish = jest.fn(async (_write: JournalWrite, persist: () => Promise<void>) => { await persist(); });
  const chosen = await journal.importLegacy(captured, set(12), 4, server.eventAt, publish,
    async () => {}, { saved: captured, server, choice: 'server', eventAt: server.eventAt });
  expect(chosen).toMatchObject({ revision: 1, expectedVersion: 4, eventAt: server.eventAt, set: set(12), ownerId: owner });
  expect((await journal.pending())[0]).toEqual(chosen);
  const stored = JSON.parse(storage.values.get(`office-gym.set-journal.v1.${owner}`)!);
  expect(stored.legacyComparisons).toEqual([{ saved: captured, server, choice: 'server', eventAt: server.eventAt }]);
  expect(stored.legacyComparisons[0].saved).not.toHaveProperty('origin');
  expect(stored.legacyComparisons[0].saved).not.toHaveProperty('eventAt');
});
it('requires an explicit completion time for a missing legacy server set', async () => {
  const storage = disk(), journal = make(storage);
  await expect(journal.importLegacy(legacy(), set(), 0, undefined as never, async (_w, persist) => persist(),
    async () => {}, { saved: legacy(), server: null, choice: 'saved', eventAt: undefined as never })).rejects.toThrow(/event time/);
  expect(storage.values.size).toBe(0);
});
it('cannot import a legacy choice over a newer journal edit', async () => {
  const storage = disk(), journal = make(storage);
  const newer = await journal.save(session, set(10), async () => {});
  const publish = jest.fn();
  await expect(journal.importLegacy(legacy(), set(12), 4, event, publish, async () => {},
    { saved: legacy(), server: { set: set(12), serverVersion: 4, eventAt: event }, choice: 'server', eventAt: event })).rejects.toThrow(/changed/);
  expect(publish).not.toHaveBeenCalled();
  expect(await journal.pending()).toEqual([newer]);
});
it('recovers a legacy conversion interrupted after journal persistence but before queue publication', async () => {
  const storage = disk(), journal = make(storage);
  await expect(journal.importLegacy(legacy(), set(), 0, event,
    async (_write, persist) => { await persist(); throw new Error('queue full'); }, async () => {},
    { saved: legacy(), server: null, choice: 'saved', eventAt: event })).rejects.toThrow('queue full');
  const replay = jest.fn(async () => {});
  await make(storage).recover(replay);
  expect(replay).toHaveBeenCalledWith(expect.objectContaining({ set: set(), expectedVersion: 0, eventAt: event, revision: 1 }));
  expect(JSON.parse(storage.values.get(`office-gym.set-journal.v1.${owner}`)!).legacyComparisons[0].saved).toEqual(legacy());
});
it('does not persist a legacy conversion if queue validation rejects its capture', async () => {
  const storage = disk(), journal = make(storage);
  const before = jest.fn(async () => {});
  await expect(journal.importLegacy(legacy(), set(), 0, event,
    async () => { throw new Error('capture changed'); }, before,
    { saved: legacy(), server: null, choice: 'saved', eventAt: event })).rejects.toThrow('capture changed');
  expect(before).not.toHaveBeenCalled();
  expect(storage.values.size).toBe(0);
});
it('captures legacy identity and payload before a caller can mutate its input', async () => {
  const storage = disk(), journal = make(storage); const captured = legacy();
  const original = legacy();
  const pending = journal.importLegacy(captured, captured.set, 0, event,
    async (_write, persist) => { await persist(); }, async () => {},
    { saved: captured, server: null, choice: 'saved', eventAt: event });
  captured.id = 'changed'; captured.set.reps = 99;
  await pending;
  expect((await journal.pending())[0]).toMatchObject({ id: original.id, set: original.set });
});

it('keeps a reopened set baseline and original completion time across restart', async () => {
  const storage = disk();
  await make(storage).captureBaselines(session, [{ set: set(), serverVersion: 7, eventAt: '2026-09-01T10:00:00.000Z' }]);
  expect(await make(storage).pending()).toEqual([]);
  const corrected = await make(storage).save(session, set(12), async () => {});
  expect(corrected).toMatchObject({ revision: 1, expectedVersion: 7, eventAt: '2026-09-01T10:00:00.000Z', set: set(12) });
});
it('does not refresh a captured baseline beneath a later correction', async () => {
  const storage = disk(), journal = make(storage);
  await journal.captureBaselines(session, [{ set: set(), serverVersion: 7, eventAt: event }]);
  await journal.captureBaselines(session, [{ set: set(10), serverVersion: 9, eventAt: '2026-10-06T11:00:00.000Z' }]);
  expect(await journal.save(session, set(12), async () => {})).toMatchObject({ expectedVersion: 7, eventAt: event });
});
it('does not replace a pending or blocked local baseline during bootstrap', async () => {
  const storage = disk(), journal = make(storage);
  const pending = await journal.save(session, set(10), async () => {});
  await journal.captureBaselines(session, [{ set: set(8), serverVersion: 7, eventAt: event }]);
  expect(await journal.pending()).toEqual([pending]);
  await journal.block(pending, 'PT409');
  await journal.captureBaselines(session, [{ set: set(8), serverVersion: 9, eventAt: event }]);
  expect(await journal.blocked()).toEqual([{ write: pending, code: 'PT409' }]);
  expect(await journal.save(session, set(12), async () => {})).toMatchObject({ expectedVersion: 0 });
});
it('validates an entire baseline capture before changing storage', async () => {
  const storage = disk(), journal = make(storage);
  await expect(journal.captureBaselines(session, [
    { set: set(), serverVersion: 7, eventAt: event },
    { set: { ...set(), set_index: 2 }, serverVersion: 0, eventAt: event },
  ])).rejects.toThrow();
  expect(storage.values.size).toBe(0);
});
it('rejects duplicate baseline identities without replacing saved data', async () => {
  const storage = disk(), journal = make(storage);
  await journal.save(session, set(), async () => {});
  const before = [...storage.values];
  await expect(journal.captureBaselines(session, [
    { set: set(), serverVersion: 7, eventAt: event },
    { set: set(10), serverVersion: 9, eventAt: event },
  ])).rejects.toThrow();
  expect([...storage.values]).toEqual(before);
});
it('captures baseline inputs before they can be mutated while waiting for storage', async () => {
  const storage = disk(), journal = make(storage);
  const input = { set: set(), serverVersion: 7, eventAt: event };
  const captured = journal.captureBaselines(session, [input]);
  input.serverVersion = 99; input.eventAt = '2026-10-06T11:00:00.000Z'; input.set.reps = 99;
  await captured;
  expect(await journal.save(session, set(12), async () => {})).toMatchObject({ expectedVersion: 7, eventAt: event });
});
it('preserves corrupt baseline storage rather than resetting a reopened set', async () => {
  const storage = disk(), journal = make(storage);
  await journal.captureBaselines(session, [{ set: set(), serverVersion: 7, eventAt: event }]);
  const key = [...storage.values.keys()][0];
  const broken = JSON.parse(storage.values.get(key)!); broken.baselines[0].serverVersion = -1;
  const raw = JSON.stringify(broken); storage.values.set(key, raw);
  await expect(journal.save(session, set(12), async () => {})).rejects.toThrow(/preserved/);
  expect(storage.values.get(key)).toBe(raw);
});
it('keeps acknowledged versions authoritative over the original captured baseline', async () => {
  const storage = disk(), journal = make(storage);
  await journal.captureBaselines(session, [{ set: set(), serverVersion: 7, eventAt: event }]);
  const first = await journal.save(session, set(12), async () => {});
  await journal.acknowledge(first, { status: 'applied', serverVersion: 8 });
  const next = await journal.save(session, set(10), async () => {});
  expect(next).toMatchObject({ expectedVersion: 8, revision: 2, eventAt: event });
});
it('keeps an initially absent set at version zero when a later device creates it', async () => {
  const storage = disk();
  await make(storage).captureBaselines(session, []);
  await make(storage).captureBaselines(session, [{ set: set(), serverVersion: 7, eventAt: event }]);
  expect(await make(storage).save(session, set(12), async () => {})).toMatchObject({ expectedVersion: 0 });
});


it('preserves timed seconds through a crash before enqueue and journal recovery', async () => {
  const storage = disk();
  const timed = { ...set(), reps: null, seconds: 40 };
  await expect(make(storage).save(session, timed, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  const enqueue = jest.fn(async () => {});
  await make(storage).recover(enqueue);
  expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ set: timed }));
});
it.each([0, -1, 40.5, 86401])('preserves invalid duration %s without publishing it', async seconds => {
  const storage = disk();
  await expect(make(storage).save(session, { ...set(), reps: null, seconds }, async () => {})).rejects.toThrow('Invalid saved set');
  expect(storage.setItem).not.toHaveBeenCalled();
});
