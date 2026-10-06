import { nativeJournalLock, type JournalLock } from './set-journal';
export interface OutboxOperation {
  id: string;
  kind: 'set' | 'progress' | 'complete';
  payload: Record<string, unknown>;
}

export interface RejectedOperation {
  operation: OutboxOperation;
  code: string;
  resolved: boolean;
}
const validOperation = (item: any): item is OutboxOperation =>
  item &&
  typeof item.id === 'string' &&
  item.id.length > 0 &&
  ['set', 'progress', 'complete'].includes(item.kind) &&
  item.payload &&
  typeof item.payload === 'object' &&
  !Array.isArray(item.payload);

export interface OutboxStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Durable, serial replay queue. Operation IDs make retries safe for idempotent writes. */
export class Outbox {
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly storage: OutboxStorage,
    private readonly send: (
      operation: OutboxOperation,
      signal: AbortSignal,
    ) => Promise<void>,
    private readonly key = 'office-gym.session-outbox.v1',
    private readonly isRejected: (error: unknown) => boolean = () => false,
    private readonly storageLock: JournalLock = nativeJournalLock,
  ) {}

  private async read(): Promise<OutboxOperation[]> {
    const raw = await this.storage.getItem(this.key);
    if (!raw) return [];
    let items: unknown;
    try {
      items = JSON.parse(raw);
    } catch {
      throw new Error(
        'The saved workout queue could not be read. Its data has been preserved.',
      );
    }
    if (!Array.isArray(items) || !items.every(validOperation)) {
      throw new Error(
        'The saved workout queue is invalid. Its data has been preserved.',
      );
    }
    return items as OutboxOperation[];
  }

  private async readRejected(): Promise<RejectedOperation[]> {
    const raw = await this.storage.getItem(`${this.key}.rejected`);
    if (!raw) return [];
    let items: unknown;
    try {
      items = JSON.parse(raw);
    } catch {
      throw new Error(
        'Rejected workout data could not be read. Its data has been preserved.',
      );
    }
    if (
      !Array.isArray(items) ||
      !items.every(
        (entry) =>
          entry &&
          validOperation(entry.operation) &&
          typeof entry.code === 'string' &&
          typeof entry.resolved === 'boolean',
      )
    ) {
      throw new Error(
        'Rejected workout data is invalid. Its data has been preserved.',
      );
    }
    return items;
  }

  rejected() {
    return this.exclusive(async () =>
      (await this.readRejected()).filter((entry) => !entry.resolved),
    );
  }

  retryRejected(
    shouldRetry: (entry: RejectedOperation) => boolean = () => true,
  ) {
    return this.exclusive(async () => {
      const items = await this.read();
      const latest = new Map<string, RejectedOperation>();
      for (const entry of await this.readRejected()) {
        if (!entry.resolved) latest.set(entry.operation.id, entry);
      }
      for (const entry of latest.values()) {
        if (!shouldRetry(entry)) continue;
        const operation = entry.operation;
        // A newer correction in the queue wins over its archived version.
        if (!items.some((item) => item.id === operation.id))
          items.push(operation);
      }
      await this.write(items);
    });
  }

  private async quarantine(operation: OutboxOperation, error: unknown) {
    return this.exclusive(async () => {
      const items = await this.read();
      const index = items.findIndex(
        (item) => JSON.stringify(item) === JSON.stringify(operation),
      );
      if (index < 0) return; // Its newer correction is still queued.
      const archive = await this.readRejected();
      const duplicate = archive.findIndex(
        (entry) =>
          !entry.resolved &&
          JSON.stringify(entry.operation) === JSON.stringify(operation),
      );
      // A user may revert to an older value. Refresh its position so the
      // archive's newest version still represents their current correction.
      if (duplicate >= 0) archive.splice(duplicate, 1);
      archive.push({
        operation,
        code: String((error as { code?: string }).code ?? 'rejected'),
        resolved: false,
      });
      await this.storage.setItem(
        `${this.key}.rejected`,
        JSON.stringify(archive),
      );
      // Never remove the queued data before its recovery copy is durable.
      items.splice(index, 1);
      await this.write(items);
    });
  }

  private async write(items: OutboxOperation[]) {
    await this.storage.setItem(this.key, JSON.stringify(items));
  }

  async pending(): Promise<OutboxOperation[]> {
    return this.read();
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    return this.storageLock(this.key, work);
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
      this.flushing = this.drain().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async drain() {
    while (true) {
      const operation = await this.exclusive(
        async () => (await this.read())[0],
      );
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
      } catch (error) {
        if (!controller.signal.aborted && this.isRejected(error)) {
          try {
            await this.quarantine(operation, error);
          } catch {
            return;
          }
          continue;
        }
        // Retain the entry even if an expired request acknowledges later.
        // Another connectivity event or explicit retry can start a fresh send.
        return;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      await this.exclusive(async () => {
        const items = await this.read();
        const archive = await this.readRejected();
        const queued = items.find((item) => item.id === operation.id);
        const latestRejected = [...archive]
          .reverse()
          .find(
            (entry) => !entry.resolved && entry.operation.id === operation.id,
          );
        const current = queued ?? latestRejected?.operation;
        const acknowledgesCurrent =
          current != null &&
          JSON.stringify(current) === JSON.stringify(operation);
        if (
          archive.some(
            (entry) => !entry.resolved && entry.operation.id === operation.id,
          )
        ) {
          await this.storage.setItem(
            `${this.key}.rejected`,
            JSON.stringify(
              archive.map((entry) =>
                entry.operation.id === operation.id &&
                (acknowledgesCurrent ||
                  JSON.stringify(entry.operation) === JSON.stringify(operation))
                  ? { ...entry, resolved: true }
                  : entry,
              ),
            ),
          );
        }
        const index = items.findIndex(
          (item) =>
            item.id === operation.id &&
            JSON.stringify(item) === JSON.stringify(operation),
        );
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
