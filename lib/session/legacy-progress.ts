import type { OutboxOperation, OutboxStorage } from './outbox';
import { nativeJournalLock, type JournalLock } from './set-journal';
/** Preserve obsolete progression operations without replaying them. */
export async function archiveLegacyProgress(
  storage: OutboxStorage,
  key: string,
  operation: OutboxOperation,
  lock: JournalLock = nativeJournalLock,
) {
  return lock(key, async () => {
    const raw = await storage.getItem(key);
    const archive: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(archive))
      throw new Error('Legacy progress archive is invalid.');
    if (
      !archive.some(
        (entry) => JSON.stringify(entry) === JSON.stringify(operation),
      )
    )
      await storage.setItem(key, JSON.stringify([...archive, operation]));
  });
}
