import { SetJournal } from '@/lib/session/set-journal';
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
