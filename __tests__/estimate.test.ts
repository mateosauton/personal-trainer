import { CATALOG } from '@/lib/catalog';
import { bodyPartLabel, estimateDay, estimateVolumeKg } from '@/lib/plan/estimate';
import type { PlanDay } from '@/lib/types';

const barbell = CATALOG.find((e) => !e.is_bodyweight)!;
const bodyweight = CATALOG.find((e) => e.is_bodyweight)!;

const item = (over: Partial<PlanDay['blocks'][number]['items'][number]> = {}) => ({
  id: `i${Math.random()}`,
  item_index: 0,
  exercise_id: barbell.id,
  sets: 3,
  reps_low: 8,
  reps_high: 12,
  seconds: null,
  tempo: null,
  notes: null,
  ...over,
});

const day = (blocks: PlanDay['blocks']): PlanDay => ({
  id: 'd1',
  day_index: 0,
  name: 'Day',
  focus: 'Focus',
  blocks,
});

describe('estimateDay', () => {
  it('counts straight sets and the middle of the rep range', () => {
    const estimate = estimateDay(
      day([
        {
          id: 'b1', block_index: 0, kind: 'straight', title: 'Block 1',
          rounds: 1, rest_seconds: 60, items: [item()],
        },
      ]),
    );
    expect(estimate.sets).toBe(3);
    expect(estimate.reps).toBe(30); // 3 sets x mid(8,12)
    expect(estimate.blocks).toBe(1);
    // 3 sets of 45s work plus 3 rests of 60s.
    expect(estimate.minutes).toBe(5);
  });

  it('multiplies circuit items by rounds, not by their own set count', () => {
    const estimate = estimateDay(
      day([
        {
          id: 'b1', block_index: 0, kind: 'circuit', title: 'Finisher',
          rounds: 3, rest_seconds: 30, items: [item({ sets: 9 }), item({ sets: 9 })],
        },
      ]),
    );
    expect(estimate.sets).toBe(6);
    expect(estimate.reps).toBe(60);
  });

  it('leaves the warm-up out of the work totals but keeps its time', () => {
    const withWarmup = estimateDay(
      day([
        {
          id: 'w', block_index: 0, kind: 'warmup', title: 'Warm-up',
          rounds: 1, rest_seconds: 0, items: [item({ seconds: 30 })],
        },
        {
          id: 'b1', block_index: 1, kind: 'straight', title: 'Block 1',
          rounds: 1, rest_seconds: 60, items: [item()],
        },
      ]),
    );
    expect(withWarmup.blocks).toBe(1);
    expect(withWarmup.reps).toBe(30);
    expect(withWarmup.minutes).toBeGreaterThan(5);
  });

  it('names the muscles the session hits', () => {
    const estimate = estimateDay(
      day([
        {
          id: 'b1', block_index: 0, kind: 'straight', title: 'Block 1',
          rounds: 1, rest_seconds: 60, items: [item()],
        },
      ]),
    );
    expect(estimate.bodyParts.length).toBeGreaterThan(0);
    expect(bodyPartLabel(estimate.bodyParts)).not.toBe('—');
  });
});

describe('estimateVolumeKg', () => {
  const straight = day([
    {
      id: 'b1', block_index: 0, kind: 'straight', title: 'Block 1',
      rounds: 1, rest_seconds: 60, items: [item()],
    },
  ]);

  it('uses the last load lifted', () => {
    const volume = estimateVolumeKg(straight, new Map([[barbell.id, 50]]), 80);
    expect(volume).toBe(3 * 10 * 50);
  });

  it('contributes nothing for an exercise with no history', () => {
    expect(estimateVolumeKg(straight, new Map(), 80)).toBe(0);
  });

  it('prices bodyweight work at the user bodyweight', () => {
    const bw = day([
      {
        id: 'b1', block_index: 0, kind: 'straight', title: 'Block 1',
        rounds: 1, rest_seconds: 60, items: [item({ exercise_id: bodyweight.id })],
      },
    ]);
    expect(estimateVolumeKg(bw, new Map(), 80)).toBe(3 * 10 * 80);
    expect(estimateVolumeKg(bw, new Map(), null)).toBe(0);
  });
});
