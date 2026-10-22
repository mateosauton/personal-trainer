import { Outbox, type OutboxOperation } from '@/lib/session/outbox';

const memory = () => {
  const values = new Map<string, string>();
  return { getItem: jest.fn(async (key: string) => values.get(key) ?? null), setItem: jest.fn(async (key: string, next: string) => { values.set(key, next); }) };
};

const operation: OutboxOperation = { id: 'set-1', kind: 'set', payload: { reps: 10 } };

describe('Outbox', () => {
  it('keeps a failed operation and replays it later', async () => {
    const storage = memory();
    const send = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const outbox = new Outbox(storage, send);

    await outbox.enqueue(operation);
    await outbox.flush();
    expect(await outbox.pending()).toHaveLength(1);

    await outbox.flush();
    expect(await outbox.pending()).toHaveLength(0);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not drop an operation enqueued during a flush', async () => {
    const storage = memory();
    let release: () => void = () => {};
    const send = jest.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; })).mockResolvedValue(undefined);
    const outbox = new Outbox(storage, send);
    await outbox.enqueue(operation);
    const flushing = outbox.flush();
    while (send.mock.calls.length === 0) await Promise.resolve();
    const enqueued = outbox.enqueue({ id: 'set-2', kind: 'set', payload: { reps: 8 } });
    release();
    await flushing;
    await enqueued;
    expect(await outbox.pending()).toEqual([]);
    expect(send.mock.calls.map((call) => call[0].id)).toEqual(['set-1', 'set-2']);
  });
});

  it('persists a new set while a network send is stalled', async () => {
    const storage = memory();
    let release!: () => void;
    const send = jest.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; })).mockResolvedValue(undefined);
    const outbox = new Outbox(storage, send);
    await outbox.enqueue(operation);
    const flushing = outbox.flush();
    while (send.mock.calls.length === 0) await Promise.resolve();
    let persisted = false;
    const enqueued = outbox.enqueue({ ...operation, id: 'set-2' }).then(() => { persisted = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const savedBeforeNetwork = persisted;
    release(); await flushing; await enqueued;
    expect(savedBeforeNetwork).toBe(true);
  });

  it('preserves corrupt stored data instead of overwriting it', async () => {
    const storage = memory();
    await storage.setItem('test', '{broken');
    const outbox = new Outbox(storage, jest.fn(), 'test');
    await expect(outbox.enqueue(operation)).rejects.toThrow(/queue|stored|saved/i);
    expect(await storage.getItem('test')).toBe('{broken');
  });

  it('rejects structurally invalid queue data without deleting it', async () => {
    const storage = memory();
    await storage.setItem('test', '{}');
    const outbox = new Outbox(storage, jest.fn(), 'test');
    await expect(outbox.pending()).rejects.toThrow(/queue|stored|saved/i);
    expect(await storage.getItem('test')).toBe('{}');
  });

  it('replays an edit saved while the older set is in flight', async () => {
    const storage = memory();
    let release!: () => void;
    const send = jest.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; })).mockResolvedValue(undefined);
    const outbox = new Outbox(storage, send);
    await outbox.enqueue(operation);
    const flushing = outbox.flush();
    while (send.mock.calls.length === 0) await Promise.resolve();
    await outbox.enqueue({ ...operation, payload: { reps: 12 } });
    release(); await flushing;
    expect(send.mock.calls.map((call) => call[0].payload.reps)).toEqual([10, 12]);
    expect(await outbox.pending()).toEqual([]);
  });

it('times out a stalled send, keeps the operation, and allows another flush', async () => {
  jest.useFakeTimers();
  try {
    const storage = memory();
    let resolveOld!: () => void;
    let signal!: AbortSignal;
    const send = jest.fn().mockImplementationOnce((_operation, currentSignal) => {
      signal = currentSignal;
      return new Promise<void>((resolve) => { resolveOld = resolve; });
    }).mockResolvedValue(undefined);
    const outbox = new Outbox(storage, send);
    await outbox.enqueue(operation);
    const stalled = outbox.flush();
    while (send.mock.calls.length === 0) await Promise.resolve();
    await jest.advanceTimersByTimeAsync(15000);
    await stalled;
    expect(signal.aborted).toBe(true);
    expect(await outbox.pending()).toEqual([operation]);
    // A late acknowledgement of the expired request must not remove the queue entry.
    resolveOld();
    await Promise.resolve();
    expect(await outbox.pending()).toEqual([operation]);
    await outbox.flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(await outbox.pending()).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});

it('serializes shared queue mutations across separate instances', async () => {
  const values = new Map<string, string>();
  let release!: () => void;
  let held = false;
  const storage = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      if (!held) {
        held = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      values.set(key, value);
    },
  };
  const a = new Outbox(storage, async () => {}, 'shared-fixture'),
    b = new Outbox(storage, async () => {}, 'shared-fixture');
  const one = a.enqueue({ id: 'first', kind: 'complete', payload: {} });
  while (!release) await Promise.resolve();
  const two = b.enqueue({ id: 'second', kind: 'complete', payload: {} });
  release();
  await Promise.all([one, two]);
  expect((await a.pending()).map((op) => op.id)).toEqual(['first', 'second']);
});
