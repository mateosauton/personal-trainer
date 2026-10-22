const mockMaybeSingle = jest.fn();
const mockQuery = {
  select: jest.fn(),
  eq: jest.fn(),
  maybeSingle: mockMaybeSingle,
};
mockQuery.select.mockReturnValue(mockQuery);
mockQuery.eq.mockReturnValue(mockQuery);

jest.mock('@/lib/db/supabase', () => ({ supabase: { from: () => mockQuery } }));

import { getActivePlan, getSessionPlanDay } from '@/lib/db/queries';

function storedPlan(split = 'Gym PPL · 6-session rotation') {
  return {
    id: 'plan', name: 'Gym PPL', split, weeks: 6,
    plan_days: [{
      id: 'day', day_index: 0, name: 'Push A', focus: 'Push',
      plan_blocks: Array.from({ length: 5 }, (_, index) => ({
        id: `b-${index}`, block_index: index,
        kind: index === 0 ? 'warmup' : index === 2 ? 'straight' : 'circuit',
        title: index === 0 ? 'Warm-up' : `Block ${index}`,
        rounds: index === 3 ? 2 : 1, rest_seconds: index === 2 ? 90 : 30,
        plan_items: Array.from({ length: index === 0 ? 1 : 4 }, (_, itemIndex) => ({
          id: `i-${index}-${itemIndex}`, item_index: itemIndex,
          exercise_id: 'Barbell_Bench_Press_-_Medium_Grip',
          sets: index === 2 ? 2 : 1, reps_low: 6, reps_high: 8,
          seconds: index === 0 ? 300 : null, tempo: null, notes: null,
        })),
      })).reverse(),
    }],
  };
}

it('restores computed timing from saved prescriptions without database timing columns', async () => {
  mockMaybeSingle.mockResolvedValue({ data: storedPlan(), error: null });
  const plan = await getActivePlan('user');
  const blocks = plan!.days[0].blocks;
  expect(blocks[0].kind).toBe('warmup');
  expect(blocks[0].duration_seconds).toBe(300);
  expect(blocks.slice(1).every((block) => block.duration_seconds! >= 360)).toBe(true);
  expect(blocks.reduce((sum, block) => sum + (block.duration_seconds ?? 0), 0)).toBe(2820);
  expect(mockQuery.select.mock.calls.at(-1)![0]).not.toContain('duration_seconds');
});

it('recalculates allocations when saved strength reps change', async () => {
  const data = storedPlan();
  mockMaybeSingle.mockResolvedValue({ data, error: null });
  const first = await getActivePlan('user');
  const strength = data.plan_days[0].plan_blocks.find((block) => block.block_index === 2)!;
  strength.plan_items.forEach((item) => { item.reps_low = 12; item.reps_high = 15; });
  const second = await getActivePlan('user');
  expect(second!.days[0].blocks[2].duration_seconds).toBeGreaterThan(first!.days[0].blocks[2].duration_seconds!);
});

it('keeps existing generated plans untimed', async () => {
  mockMaybeSingle.mockResolvedValue({ data: storedPlan('Upper / Lower'), error: null });
  const plan = await getActivePlan('user');
  expect(plan!.days[0].blocks.every((block) => block.duration_seconds == null)).toBe(true);
});

it('restores the original timed session even after the active plan changes', async () => {
  const plan = storedPlan();
  mockMaybeSingle.mockResolvedValue({
    data: { plan_days: { ...plan.plan_days[0], plans: { split: plan.split } } }, error: null,
  });
  const day = await getSessionPlanDay('session', 'user');
  expect(day!.blocks[0].duration_seconds).toBe(300);
  expect(day!.blocks.reduce((sum, block) => sum + (block.duration_seconds ?? 0), 0)).toBe(2820);
  expect(day!.blocks[2].title).toBe('Block 2 · Build strength');
});
