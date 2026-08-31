import { Outbox, type OutboxOperation } from '@/lib/session/outbox';

const memory = () => {
  let value: string | null = null;
  return { getItem: jest.fn(async () => value), setItem: jest.fn(async (_: string, next: string) => { value = next; }) };
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
    const send = jest.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const outbox = new Outbox(storage, send);
    await outbox.enqueue(operation);
    const flushing = outbox.flush();
    while (send.mock.calls.length === 0) await Promise.resolve();
    const enqueued = outbox.enqueue({ id: 'set-2', kind: 'set', payload: { reps: 8 } });
    release();
    await flushing;
    await enqueued;
    expect((await outbox.pending()).map((item) => item.id)).toEqual(['set-2']);
  });
});
