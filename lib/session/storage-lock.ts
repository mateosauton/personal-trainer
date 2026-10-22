import { Platform } from 'react-native';
import { nativeJournalLock, type JournalLock } from './set-journal';
interface BrowserLocks {
  request<T>(
    name: string,
    options: { mode: 'exclusive' },
    work: () => Promise<T>,
  ): Promise<T>;
}
/** Fail closed on web when shared browser storage cannot be locked. */
export const storageLock: JournalLock = (key, work) => {
  if (Platform.OS !== 'web') return nativeJournalLock(key, work);
  const locks = (
    globalThis as unknown as { navigator?: { locks?: BrowserLocks } }
  ).navigator?.locks;
  if (!locks)
    return Promise.reject(
      new Error(
        'This browser cannot safely save workouts across tabs. Use the native app or a browser with Web Locks.',
      ),
    );
  return locks.request(
    `office-gym.storage:${key}`,
    { mode: 'exclusive' },
    work,
  );
};
