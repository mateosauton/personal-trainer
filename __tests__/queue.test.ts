import { buildQueue, partnerOf, type QueueEntry } from '@/lib/session/queue';
import type { PlanDay } from '@/lib/types';

const item = (id: string, sets: number) => ({
  id, item_index: 0, exercise_id: `ex-${id}`, sets,
  reps_low: 8, reps_high: 12, seconds: null, tempo: null, notes: null,
});

const day: PlanDay = {
  id: 'day', day_index: 0, name: 'Upper A', focus: 'Horizontal',
  blocks: [
    { id: 'w', block_index: 0, kind: 'warmup', title: 'Warm-up', rounds: 1, rest_seconds: 20,
      items: [item('w1', 1), item('w2', 1)] },
    { id: 'b1', block_index: 1, kind: 'straight', title: 'Block 1', rounds: 1, rest_seconds: 150,
      items: [item('a', 4)] },
    { id: 'b2', block_index: 2, kind: 'straight', title: 'Block 2', rounds: 1, rest_seconds: 105,
      items: [item('b', 3)] },
    { id: 'b3', block_index: 3, kind: 'superset', title: 'Block 3', rounds: 3, rest_seconds: 60,
      items: [item('c', 1), item('d', 1)] },
    { id: 'b4', block_index: 4, kind: 'circuit', title: 'Block 4', rounds: 2, rest_seconds: 40,
      items: [item('e', 1), item('f', 1)] },
  ],
};

describe('buildQueue', () => {
  const queue = buildQueue(day);

  it('emits one entry per set actually performed', () => {
    // 2 warm-up + 4 + 3 + (3 rounds x 2) + (2 rounds x 2) = 19
    expect(queue).toHaveLength(19);
  });

  it('numbers straight sets within their exercise', () => {
    const sets = queue.filter((q: QueueEntry) => q.item.id === 'a');
    expect(sets.map((s: QueueEntry) => s.set)).toEqual([1, 2, 3, 4]);
    expect(sets.every((s: QueueEntry) => s.setsTotal === 4)).toBe(true);
  });

  it('rotates supersets round by round rather than finishing one exercise first', () => {
    const superset = queue.filter((q: QueueEntry) => q.block.id === 'b3');
    expect(superset.map((q: QueueEntry) => `${q.item.id}${q.round}`)).toEqual([
      'c1', 'd1', 'c2', 'd2', 'c3', 'd3',
    ]);
  });

  it('numbers work blocks 1 to 4 and leaves the warm-up out of the count', () => {
    expect(queue.find((q: QueueEntry) => q.block.id === 'w')!.blockOrdinal).toBe(0);
    expect(queue.find((q: QueueEntry) => q.block.id === 'b1')!.blockOrdinal).toBe(1);
    expect(queue.find((q: QueueEntry) => q.block.id === 'b4')!.blockOrdinal).toBe(4);
    expect(queue.every((q: QueueEntry) => q.blockCount === 4)).toBe(true);
  });

  it('pairs superset partners and leaves straight sets unpaired', () => {
    expect(partnerOf(queue.find((q: QueueEntry) => q.item.id === 'c')!)!.id).toBe('d');
    expect(partnerOf(queue.find((q: QueueEntry) => q.item.id === 'a')!)).toBeNull();
  });

  it('keeps unique keys so React never reuses a set row', () => {
    expect(new Set(queue.map((q: QueueEntry) => q.key)).size).toBe(queue.length);
  });
});
