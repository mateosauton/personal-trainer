import { buildQueue, partnerOf, restAfter, type QueueEntry } from '@/lib/session/queue';
import type { PlanDay } from '@/lib/types';
import { withDayTiming } from '@/lib/plan/timing';

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

  it('previews the next circuit station in order and stops at each round boundary', () => {
    const circuit: PlanDay = { ...day, blocks: [{
      ...day.blocks[4], rounds: 2, items: [item('a', 1), item('b', 1), item('c', 1), item('d', 1)],
    }] };
    const entries = buildQueue(circuit);
    expect(partnerOf(entries[2])?.id).toBe('d');
    expect(partnerOf(entries[3])).toBeNull();
    expect(partnerOf(entries[7])).toBeNull();
  });

  it('keeps unique keys so React never reuses a set row', () => {
    expect(new Set(queue.map((q: QueueEntry) => q.key)).size).toBe(queue.length);
  });
});

describe('timed queue', () => {
  it('divides each block budget across its prescribed sets without adding sets', () => {
    const timed = withDayTiming(day);
    const queue = buildQueue(timed);
    expect(queue).toHaveLength(buildQueue(day).length);
    for (const block of timed.blocks) {
      const entries = queue.filter((entry) => entry.block.id === block.id);
      expect(entries.reduce((sum, entry) => sum + (entry.slotSeconds ?? 0), 0)).toBe(block.duration_seconds);
      expect(entries.every((entry) => entry.workSeconds! + entry.restSeconds! === entry.slotSeconds)).toBe(true);
    }
  });

  it('gives longer rep prescriptions larger stations within the same block', () => {
    const timed: PlanDay = {
      ...day,
      blocks: [{ ...day.blocks[1], duration_seconds: 360, items: [
        { ...item('short', 1), reps_low: 4, reps_high: 4 },
        { ...item('long', 1), reps_low: 16, reps_high: 16 },
      ] }],
    };
    const [short, long] = buildQueue(timed);
    expect(long.slotSeconds).toBeGreaterThan(short.slotSeconds!);
    expect(short.workSeconds).toBe(12);
    expect(long.workSeconds).toBe(48);
  });

  it('caps movement guidance at the station budget instead of producing negative rest', () => {
    const timed: PlanDay = {
      ...day,
      blocks: [{ ...day.blocks[1], duration_seconds: 30, items: [
        { ...item('hold', 1), seconds: 60 },
      ] }],
    };
    const [entry] = buildQueue(timed);
    expect(entry.workSeconds).toBe(30);
    expect(entry.restSeconds).toBe(0);
  });
});

describe('round transitions', () => {
  const queue = buildQueue(day);

  it('rests after each superset round, not between its exercises', () => {
    expect(queue.filter(q => q.block.id === 'b3').map(restAfter)).toEqual([0, 60, 0, 60, 0, 60]);
  });

  it('rests after each circuit round, not between its exercises', () => {
    expect(queue.filter(q => q.block.id === 'b4').map(restAfter)).toEqual([0, 40, 0, 40]);
  });

  it('keeps the prescribed rest after straight sets', () => {
    expect(queue.filter(q => q.block.id === 'b1').map(restAfter)).toEqual([150, 150, 150, 150]);
  });

  it('shows the next circuit exercise and stops the peek at the round boundary', () => {
    const block = { ...day.blocks[4], items: [item('e', 1), item('f', 1), item('g', 1)] };
    const circuit = buildQueue({ ...day, blocks: [block] });
    expect(circuit.map(q => partnerOf(q)?.id ?? null)).toEqual(['f', 'g', null, 'f', 'g', null]);
    expect(circuit.map(restAfter)).toEqual([0, 0, 40, 0, 0, 40]);
  });
});
