export interface OutboxOperation {
  id: string;
  kind: 'set' | 'progress' | 'complete';
  payload: Record<string, unknown>;
}

export interface OutboxStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Durable, serial replay queue. Operation IDs make retries safe for idempotent writes. */
export class Outbox {
  private tail: Promise<void> = Promise.resolve();
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly storage: OutboxStorage,
    private readonly send: (operation: OutboxOperation, signal: AbortSignal) => Promise<void>,
    private readonly key = 'office-gym.session-outbox.v1',
  ) {}

  private async read(): Promise<OutboxOperation[]> {
    const raw = await this.storage.getItem(this.key);
    if (!raw) return [];
    let items: unknown;
    try { items = JSON.parse(raw); } catch {
      throw new Error('The saved workout queue could not be read. Its data has been preserved.');
    }
    if (!Array.isArray(items) || !items.every((item) =>
      item && typeof item.id === 'string' && item.id.length > 0
      && ['set', 'progress', 'complete'].includes(item.kind)
      && item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload))) {
      throw new Error('The saved workout queue is invalid. Its data has been preserved.');
    }
    return items as OutboxOperation[];
  }

  private async write(items: OutboxOperation[]) {
    await this.storage.setItem(this.key, JSON.stringify(items));
  }

  async pending(): Promise<OutboxOperation[]> { return this.read(); }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work, work);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async enqueue(operation: OutboxOperation) {
    await this.exclusive(async () => {
      const items = await this.read();
      const index = items.findIndex((item) => item.id === operation.id);
      if (index >= 0) items[index] = operation;
      else items.push(operation);
      await this.write(items);
    });
  }

  flush(): Promise<void> {
    if (!this.flushing) {
      this.flushing = this.drain().finally(() => { this.flushing = null; });
    }
    return this.flushing;
  }

  private async drain() {
    while (true) {
      const operation = await this.exclusive(async () => (await this.read())[0]);
      if (!operation) return;
      // Hold the storage lock only for disk operations. Network stalls must
      // never prevent the next set from being saved on the device.
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Workout sync timed out.'));
          }, 15_000);
        });
        await Promise.race([this.send(operation, controller.signal), deadline]);
      } catch {
        // Retain the entry even if an expired request acknowledges later.
        // Another connectivity event or explicit retry can start a fresh send.
        return;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      await this.exclusive(async () => {
        const items = await this.read();
        const index = items.findIndex((item) => item.id === operation.id
          && JSON.stringify(item) === JSON.stringify(operation));
        // An edited set with the same ID needs another send; do not delete it
        // because an older version finished while the edit was being saved.
        if (index >= 0) {
          items.splice(index, 1);
          await this.write(items);
        }
      });
    }
  }
}
