import { candidates, getExercise } from '@/lib/catalog';
import {
  generateGymRoutine,
  GYM_EQUIPMENT,
  GYM_ROUTINE_SPLIT,
  isGymRoutine,
} from '@/lib/plan/gym-routine';

describe('the personal gym rotation', () => {
  it('keeps six training sessions in the approved push, pull, legs order', () => {
    const plan = generateGymRoutine();
    expect(plan.split).toBe(GYM_ROUTINE_SPLIT);
    expect(plan.days.map((day) => day.name)).toEqual([
      'Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B',
    ]);
    const workExercises = plan.days.flatMap((day) => day.blocks.slice(1).flatMap(
      (block) => block.items.map((item) => item.exercise_id),
    ));
    expect(new Set(workExercises).size).toBe(96);
    expect(isGymRoutine(plan)).toBe(true);
    expect(isGymRoutine({ split: 'Full body' })).toBe(false);
  });

  it('fits every session into 47 minutes with at least six minutes per work block', () => {
    for (const day of generateGymRoutine().days) {
      expect(day.blocks.map((block) => block.items.length)).toEqual([5, 4, 4, 4, 4]);
      expect(day.blocks.reduce((sum, block) => sum + (block.duration_seconds ?? 0), 0)).toBe(47 * 60);
      expect(day.blocks[0].duration_seconds).toBe(5 * 60);
      expect(day.blocks[0].items.reduce((sum, item) => sum + (item.seconds ?? 0), 0)).toBe(5 * 60);
      for (const block of day.blocks.slice(1)) expect(block.duration_seconds).toBeGreaterThanOrEqual(6 * 60);
      expect(day.blocks[2].duration_seconds! + day.blocks[3].duration_seconds!).toBeGreaterThan(
        day.blocks[1].duration_seconds! + day.blocks[4].duration_seconds!,
      );
    }
  });

  it('preserves the strength sets, advanced rounds, and the full-body/core bookends', () => {
    for (const day of generateGymRoutine().days) {
      const [, fullBody, strength, advanced, core] = day.blocks;
      expect([fullBody.rounds, advanced.rounds, core.rounds]).toEqual([1, 2, 1]);
      expect(strength.kind).toBe('straight');
      expect(strength.items.every((item) => item.sets === 2)).toBe(true);
      expect(advanced.items.every((item) => item.sets === 1)).toBe(true);
      expect(getExercise(fullBody.items[3].exercise_id)?.pattern).toBe('core');
      expect(core.items.every((item) => getExercise(item.exercise_id)?.pattern === 'core')).toBe(true);
    }
  });

  it('retains the approved combinations and both-side hold prescriptions', () => {
    const plan = generateGymRoutine();
    const names = (day: number, block: number) => plan.days[day].blocks[block].items.map(
      (item) => getExercise(item.exercise_id)?.name,
    );
    expect(names(0, 3)).toEqual([
      'Dumbbell thruster', 'Reverse lunge, then single-arm dumbbell press',
      'Push-up to alternating knee drive', 'Forward bear crawl',
    ]);
    expect(names(5, 2)).toEqual([
      'Barbell front squat', 'Barbell hip thrust', 'Dumbbell Romanian deadlift',
      'Seated calf raise with dumbbells on thighs',
    ]);
    const sidePlank = plan.days[0].blocks[4].items[3];
    expect(sidePlank.seconds).toBe(30);
    expect(sidePlank.notes).toContain('15 seconds per side');
    const lungePress = plan.days[0].blocks[3].items[1];
    expect([lungePress.reps_low, lungePress.reps_high]).toEqual([4, 4]);
    expect(lungePress.notes).toContain('Per side');
  });

  it('resolves all 126 slots to instructions using only the available gym equipment', () => {
    let slots = 0;
    for (const day of generateGymRoutine().days) {
      for (const block of day.blocks) {
        for (const item of block.items) {
          const exercise = getExercise(item.exercise_id);
          expect(exercise).toBeDefined();
          expect(GYM_EQUIPMENT).toContain(exercise!.equipment);
          expect(exercise!.instructions.length).toBeGreaterThan(0);
          expect(exercise!.instructions.join(' ')).not.toMatch(/\b(?:Smith machine|wooden board|stability ball|resistance band|medicine ball)\b/i);
          if (item.seconds == null && /\bPer side\b/.test(item.notes ?? '')) {
            expect(exercise!.is_unilateral).toBe(true);
          }
          slots += 1;
        }
      }
    }
    expect(slots).toBe(126);
    expect(GYM_EQUIPMENT).not.toContain('cable');
    expect(GYM_EQUIPMENT).not.toContain('bands');
  });

  it('does not present a generic lift image as the demonstration for a combination', () => {
    const plan = generateGymRoutine();
    const combo = getExercise(plan.days[0].blocks[3].items[1].exercise_id)!;
    expect(combo.media_refs).toEqual({ start: '', end: '' });
    const bench = getExercise(plan.days[0].blocks[2].items[0].exercise_id)!;
    expect(bench.media_refs.start).toContain('Barbell_Bench_Press');
  });

  it('keeps routine-only variations out of the existing questionnaire generator pool', () => {
    const routineIds = new Set(generateGymRoutine().days.flatMap((day) =>
      day.blocks.flatMap((block) => block.items.map((item) => item.exercise_id)),
    ));
    const pool = candidates({
      equipment: GYM_EQUIPMENT, level: 'advanced',
      patterns: ['core', 'squat', 'hinge', 'lunge', 'h_push', 'v_push', 'h_pull', 'v_pull', 'conditioning', 'mobility'],
    });
    expect(pool.some((exercise) => routineIds.has(exercise.id))).toBe(false);
  });
});
