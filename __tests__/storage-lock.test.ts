import { Platform } from 'react-native';
import { storageLock } from '@/lib/session/storage-lock';
it('fails closed on web if Web Locks are unavailable', async () => {
  const previous = Platform.OS;
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  try {
    const work = jest.fn(async () => 1);
    await expect(storageLock('fixture', work)).rejects.toThrow('Web Locks');
    expect(work).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: previous,
    });
    if (nav) Object.defineProperty(globalThis, 'navigator', nav);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
it('passes a storage-scoped exclusive lock to the browser API', async () => {
  const previous = Platform.OS;
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const request = jest.fn(async (_key, _options, work) => work());
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { locks: { request } },
  });
  try {
    await expect(storageLock('fixture', async () => 42)).resolves.toBe(42);
    expect(request).toHaveBeenCalledWith(
      'office-gym.storage:fixture',
      { mode: 'exclusive' },
      expect.any(Function),
    );
  } finally {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: previous,
    });
    if (nav) Object.defineProperty(globalThis, 'navigator', nav);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
