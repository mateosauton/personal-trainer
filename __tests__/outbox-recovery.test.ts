import { Outbox, type OutboxOperation } from '@/lib/session/outbox';
const op = (id: string, reps = 8): OutboxOperation => ({
  id,
  kind: 'set',
  payload: { sessionId: id, reps },
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
// The recovery classifier is supplied by the account-bound transport.
const rejected = (error: unknown) =>
  (error as { code?: string })?.code === '23503';
const make = (storage: ReturnType<typeof disk>, send: jest.Mock) =>
  new Outbox(storage, send, 'account-A', rejected);
it('preserves a rejected set across restart and sends the next workout', async () => {
  const storage = disk();
  const send = jest
    .fn()
    .mockRejectedValueOnce({ code: '23503' })
    .mockResolvedValue(undefined);
  const queue = make(storage, send);
  await queue.enqueue(op('bad'));
  await queue.enqueue(op('good'));
  await queue.flush();
  expect(send.mock.calls.map((call) => call[0].id)).toEqual(['bad', 'good']);
  expect(await queue.pending()).toEqual([]);
  const restarted = make(storage, send);
  expect(await restarted.rejected()).toEqual([
    { operation: op('bad'), code: '23503', resolved: false },
  ]);
  await restarted.retryRejected();
  await restarted.flush();
  expect(await restarted.rejected()).toEqual([]);
  expect(storage.values.get('account-A.rejected')).toContain('bad');
});
it('keeps the original queue if the rejected archive cannot be persisted', async () => {
  const storage = disk();
  const queue = make(storage, jest.fn().mockRejectedValue({ code: '23503' }));
  await queue.enqueue(op('bad'));
  await queue.enqueue(op('good'));
  storage.setItem.mockImplementation(async (key, value) => {
    if (key.endsWith('.rejected')) throw new Error('disk full');
    storage.values.set(key, value);
  });
  await queue.flush();
  expect(await queue.pending()).toEqual([op('bad'), op('good')]);
});
it('does not quarantine an edited set because its old version was rejected', async () => {
  const storage = disk();
  let reject!: (error: unknown) => void;
  const send = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValue(undefined);
  const queue = make(storage, send);
  await queue.enqueue(op('edited'));
  const flushing = queue.flush();
  while (!reject) await Promise.resolve();
  await queue.enqueue(op('edited', 10));
  reject({ code: '23503' });
  await flushing;
  expect(await queue.rejected()).toEqual([]);
  expect(send.mock.calls.map((call) => call[0].payload.reps)).toEqual([8, 10]);
});
it('keeps network and authentication failures pending without archiving', async () => {
  const storage = disk();
  const queue = make(storage, jest.fn().mockRejectedValue({ code: '42501' }));
  await queue.enqueue(op('pending'));
  await queue.flush();
  expect(await queue.pending()).toEqual([op('pending')]);
  expect(storage.values.has('account-A.rejected')).toBe(false);
});
it('retries without replacing a newer correction and resolves the archived failure', async () => {
  const storage = disk();
  const send = jest
    .fn()
    .mockRejectedValueOnce({ code: '23503' })
    .mockResolvedValue(undefined);
  const queue = make(storage, send);
  await queue.enqueue(op('edited'));
  await queue.flush();
  await queue.enqueue(op('edited', 12));
  await queue.retryRejected();
  await queue.flush();
  expect(send.mock.calls.map((call) => call[0].payload.reps)).toEqual([8, 12]);
  expect(await queue.rejected()).toEqual([]);
});

it('retries the latest rejected correction instead of the original set', async () => {
  const storage = disk();
  const send = jest
    .fn()
    .mockRejectedValueOnce({ code: '23503' })
    .mockRejectedValueOnce({ code: '23503' })
    .mockResolvedValue(undefined);
  const queue = make(storage, send);
  await queue.enqueue(op('corrected', 8));
  await queue.flush();
  await queue.enqueue(op('corrected', 12));
  await queue.flush();
  await queue.retryRejected();
  await queue.flush();
  expect(send.mock.calls.map((call) => call[0].payload.reps)).toEqual([
    8, 12, 12,
  ]);
  expect(await queue.rejected()).toEqual([]);
});

it('recovers after a crash between archiving and removing a rejected operation', async () => {
  const storage = disk();
  const send = jest.fn().mockRejectedValue({ code: '23503' });
  const queue = make(storage, send);
  await queue.enqueue(op('bad'));
  await queue.enqueue(op('good'));
  let failed = false;
  storage.setItem.mockImplementation(async (key, value) => {
    if (key === 'account-A' && !failed) {
      failed = true;
      throw new Error('disk full');
    }
    storage.values.set(key, value);
  });
  await queue.flush();
  expect(await queue.pending()).toEqual([op('bad'), op('good')]);
  expect(await queue.rejected()).toHaveLength(1);
  send.mockImplementation(async (operation) => {
    if (operation.id === 'bad') throw { code: '23503' };
  });
  const restarted = make(storage, send);
  await restarted.flush();
  expect(await restarted.pending()).toEqual([]);
  expect(await restarted.rejected()).toHaveLength(1);
});

it('preserves a malformed archive and leaves its queued operation intact', async () => {
  const storage = disk();
  const queue = make(storage, jest.fn().mockRejectedValue({ code: '23503' }));
  await queue.enqueue(op('bad'));
  storage.values.set('account-A.rejected', '{broken');
  await queue.flush();
  expect(await queue.pending()).toEqual([op('bad')]);
  expect(storage.values.get('account-A.rejected')).toBe('{broken');
});

it('retries the current values when a correction reverts to an earlier rejected value', async () => {
  const storage = disk();
  const send = jest
    .fn()
    .mockRejectedValueOnce({ code: '23503' })
    .mockRejectedValueOnce({ code: '23503' })
    .mockRejectedValueOnce({ code: '23503' })
    .mockResolvedValue(undefined);
  const queue = make(storage, send);
  for (const reps of [8, 12, 8]) {
    await queue.enqueue(op('reverted', reps));
    await queue.flush();
  }
  await queue.retryRejected();
  await queue.flush();
  expect(send.mock.calls.map((call) => call[0].payload.reps)).toEqual([
    8, 12, 8, 8,
  ]);
  expect(await queue.rejected()).toEqual([]);
});
it('does not clear a newer rejected edit when another tab acknowledges an older write', async () => {
  const storage = disk();
  let release!: () => void;
  const older = new Outbox(
    storage,
    async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    'shared-recovery',
    rejected,
  );
  const newer = new Outbox(
    storage,
    async () => {
      throw { code: '23503' };
    },
    'shared-recovery',
    rejected,
  );
  await older.enqueue(op('same', 8));
  const oldFlush = older.flush();
  while (!release) await Promise.resolve();
  await newer.enqueue(op('same', 12));
  await newer.flush();
  release();
  await oldFlush;
  expect(await newer.rejected()).toEqual([
    { operation: op('same', 12), code: '23503', resolved: false },
  ]);
});
it('does not replay an older retryable payload when the latest rejected value needs review', async () => {
  const storage = disk();
  const queue = new Outbox(
    storage,
    async () => {},
    'mixed-recovery',
    () => true,
  );
  storage.values.set(
    'mixed-recovery.rejected',
    JSON.stringify([
      { operation: op('same', 8), code: '23503', resolved: false },
      { operation: op('same', 12), code: 'PT409', resolved: false },
    ]),
  );
  await queue.retryRejected((entry) => entry.code !== 'PT409');
  expect(await queue.pending()).toEqual([]);
  expect(await queue.rejected()).toHaveLength(2);
});

it('publishes a reviewed replacement only after preserving its exact rejected capture', async () => {
  const storage = disk();
  const queue = make(storage, jest.fn().mockRejectedValue({ code: '23503' }));
  await queue.enqueue(op('legacy', 8)); await queue.flush();
  const [capture] = await queue.rejected();
  const replacement = op('legacy', 12);
  await queue.replaceRejected(capture, async () => replacement);
  expect(await queue.pending()).toEqual([replacement]);
  expect(await queue.rejected()).toEqual([capture]); // A choice is not an acknowledgement.
});
it('rejects a legacy choice if a newer correction is queued before publication', async () => {
  const storage = disk();
  const queue = make(storage, jest.fn().mockRejectedValue({ code: '23503' }));
  await queue.enqueue(op('legacy', 8)); await queue.flush();
  const [capture] = await queue.rejected();
  await queue.enqueue(op('legacy', 10));
  const prepare = jest.fn(async () => op('legacy', 12));
  await expect(queue.replaceRejected(capture, prepare)).rejects.toThrow(/changed/);
  expect(prepare).not.toHaveBeenCalled();
  expect(await queue.pending()).toEqual([op('legacy', 10)]);
});
it('rejects a legacy choice if a newer rejection replaced the reviewed value', async () => {
  const storage = disk();
  const queue = make(storage, jest.fn().mockRejectedValue({ code: '23503' }));
  await queue.enqueue(op('legacy', 8)); await queue.flush();
  const [capture] = await queue.rejected();
  await queue.enqueue(op('legacy', 10)); await queue.flush();
  const prepare = jest.fn(async () => op('legacy', 12));
  await expect(queue.replaceRejected(capture, prepare)).rejects.toThrow(/changed/);
  expect(prepare).not.toHaveBeenCalled();
});
it('retains a reviewed rejection if replacement preparation fails', async () => {
  const storage = disk();
  const queue = make(storage, jest.fn().mockRejectedValue({ code: '23503' }));
  await queue.enqueue(op('legacy')); await queue.flush();
  const [capture] = await queue.rejected();
  await expect(queue.replaceRejected(capture, async () => { throw new Error('journal full'); })).rejects.toThrow('journal full');
  expect(await queue.rejected()).toEqual([capture]);
  expect(await queue.pending()).toEqual([]);
});
it('holds legacy exclusions stable until baseline persistence completes', async () => {
  const storage = disk(), queue = make(storage, jest.fn());
  await queue.enqueue(op('legacy'));
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = queue.withSetExclusions(async excluded => {
    expect(excluded).toEqual(['legacy']); entered();
    await new Promise<void>(resolve => { release = resolve; });
  });
  await started;
  let queued = false; const enqueue = queue.enqueue(op('new')).then(() => { queued = true; });
  await Promise.resolve(); await Promise.resolve(); expect(queued).toBe(false);
  release(); await held; await enqueue; expect(queued).toBe(true);
});
