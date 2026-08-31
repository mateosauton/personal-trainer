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

  constructor(
    private readonly storage: OutboxStorage,
    private readonly send: (operation: OutboxOperation) => Promise<void>,
    private readonly key = 'office-gym.session-outbox.v1',
  ) {}

  private async read(): Promise<OutboxOperation[]> {
    const raw = await this.storage.getItem(this.key);
    if (!raw) return [];
    try { return JSON.parse(raw) as OutboxOperation[]; } catch { return []; }
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

  async flush() {
    await this.exclusive(async () => {
      let items = await this.read();
      while (items.length) {
        try {
          await this.send(items[0]);
        } catch {
          return;
        }
        items = items.slice(1);
        await this.write(items);
      }
    });
  }
}
