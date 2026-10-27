import { createSyncRetry } from '@/lib/session/retry';

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

it('starts immediately and does not retry an idle queue', async () => {
  const attempt = jest.fn(async () => false);
  const retry = createSyncRetry({ attempt, isActive: () => true });
  retry.trigger();
  expect(attempt).toHaveBeenCalledTimes(1);
  await settle();
  expect(jest.getTimerCount()).toBe(0);
  retry.stop();
});

it('backs off pending writes with a bounded retry budget', async () => {
  const attempt = jest.fn(async () => true);
  const retry = createSyncRetry({ attempt, isActive: () => true, random: () => 0.5 });
  retry.trigger();
  await settle();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000]) {
    const before = attempt.mock.calls.length;
    await jest.advanceTimersByTimeAsync(delay - 1);
    expect(attempt).toHaveBeenCalledTimes(before);
    await jest.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(before + 1);
  }
  expect(attempt).toHaveBeenCalledTimes(7);
  expect(jest.getTimerCount()).toBe(0);
  retry.stop();
});

it('retries thrown transport errors with the same bounded policy', async () => {
  const attempt = jest.fn(async (): Promise<boolean> => { throw new Error('offline'); });
  const retry = createSyncRetry({ attempt, isActive: () => true, random: () => 0.5 });
  retry.trigger();
  await settle();
  await jest.runAllTimersAsync();
  expect(attempt).toHaveBeenCalledTimes(7);
  expect(jest.getTimerCount()).toBe(0);
  retry.stop();
});

it('stops retrying when only reviewable conflicts remain', async () => {
  const attempt = jest.fn(async () => true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const retry = createSyncRetry({ attempt, isActive: () => true, random: () => 0.5 });
  retry.trigger();
  await settle();
  await jest.advanceTimersByTimeAsync(1000);
  expect(attempt).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
  retry.stop();
});

it('a fresh foreground or enqueue event resets an exhausted retry budget', async () => {
  const attempt = jest.fn(async () => true);
  const retry = createSyncRetry({ attempt, isActive: () => true, random: () => 0.5 });
  retry.trigger(); await settle(); await jest.runAllTimersAsync();
  expect(attempt).toHaveBeenCalledTimes(7);
  retry.trigger(); await settle();
  expect(attempt).toHaveBeenCalledTimes(8);
  await jest.advanceTimersByTimeAsync(1000);
  expect(attempt).toHaveBeenCalledTimes(9);
  retry.stop();
});

it('a fresh trigger replaces the sleeping timer with an immediate attempt', async () => {
  const attempt = jest.fn(async () => true);
  const retry = createSyncRetry({ attempt, isActive: () => true, random: () => 0.5 });
  retry.trigger(); await settle();
  await jest.advanceTimersByTimeAsync(500);
  retry.trigger(); await settle();
  expect(attempt).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(1);
  await jest.advanceTimersByTimeAsync(999);
  expect(attempt).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(1);
  expect(attempt).toHaveBeenCalledTimes(3);
  retry.stop();
});

it('coalesces concurrent triggers into one follow-up without overlapping attempts', async () => {
  let release!: (value: boolean) => void;
  const attempt = jest.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
  const retry = createSyncRetry({ attempt, isActive: () => true, random: () => 0.5 });
  retry.trigger(); retry.trigger(); retry.trigger();
  expect(attempt).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  release(false); await settle();
  expect(attempt).toHaveBeenCalledTimes(2);
  release(false); await settle();
  expect(attempt).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
  retry.stop();
});

it('does not send or schedule while the account is inactive', async () => {
  let active = false;
  const attempt = jest.fn(async () => true);
  const retry = createSyncRetry({ attempt, isActive: () => active, random: () => 0.5 });
  retry.trigger(); await settle();
  expect(attempt).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  active = true; retry.trigger(); await settle();
  active = false;
  await jest.advanceTimersByTimeAsync(1000);
  expect(attempt).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  retry.stop();
});

it('ignores an attempt completing after its account became inactive', async () => {
  let active = true;
  let release!: (value: boolean) => void;
  const attempt = jest.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
  const retry = createSyncRetry({ attempt, isActive: () => active });
  retry.trigger();
  active = false; release(true); await settle();
  expect(jest.getTimerCount()).toBe(0);
  retry.stop();
});

it('stop cancels a timer and prevents future trigger calls', async () => {
  const attempt = jest.fn(async () => true);
  const retry = createSyncRetry({ attempt, isActive: () => true });
  retry.trigger(); await settle();
  retry.stop(); retry.trigger();
  await jest.runAllTimersAsync();
  expect(attempt).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('stop ignores in-flight completion and a previously requested follow-up', async () => {
  let release!: (value: boolean) => void;
  const attempt = jest.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
  const retry = createSyncRetry({ attempt, isActive: () => true });
  retry.trigger(); retry.trigger(); retry.stop();
  release(true); await settle(); await jest.runAllTimersAsync();
  expect(attempt).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('jitters backoff and never exceeds the thirty-second cap', async () => {
  const attempt = jest.fn(async () => true);
  const retry = createSyncRetry({ attempt, isActive: () => true, random: () => 1 });
  retry.trigger(); await settle();
  for (const delay of [1200, 2400, 4800, 9600, 19200, 30000]) {
    const before = attempt.mock.calls.length;
    await jest.advanceTimersByTimeAsync(delay - 1);
    expect(attempt).toHaveBeenCalledTimes(before);
    await jest.advanceTimersByTimeAsync(1);
    expect(attempt).toHaveBeenCalledTimes(before + 1);
  }
  retry.stop();
});
