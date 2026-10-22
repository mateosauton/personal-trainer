import { archiveLegacyProgress } from '@/lib/session/legacy-progress';
import type { OutboxOperation } from '@/lib/session/outbox';
const op = (id: string): OutboxOperation => ({
  id,
  kind: 'progress',
  payload: { userId: 'fixture', rows: [] },
});
it('keeps both recovery copies when two drainers archive at once', async () => {
  const values = new Map<string, string>();
  let release!: () => void;
  let held = false;
  const disk = {
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
  const first = archiveLegacyProgress(disk, 'fixture-archive', op('one'));
  while (!release) await Promise.resolve();
  const second = archiveLegacyProgress(disk, 'fixture-archive', op('two'));
  release();
  await Promise.all([first, second]);
  expect(JSON.parse(values.get('fixture-archive')!)).toEqual([
    op('one'),
    op('two'),
  ]);
});
it('deduplicates replay without replacing corrupt recovery data', async () => {
  const values = new Map<string, string>();
  const disk = {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
  await archiveLegacyProgress(disk, 'fixture-archive', op('one'));
  await archiveLegacyProgress(disk, 'fixture-archive', op('one'));
  expect(JSON.parse(values.get('fixture-archive')!)).toEqual([op('one')]);
  values.set('fixture-archive', '{bad');
  await expect(
    archiveLegacyProgress(disk, 'fixture-archive', op('two')),
  ).rejects.toThrow();
  expect(values.get('fixture-archive')).toBe('{bad');
});
