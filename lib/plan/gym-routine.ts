import { gymExerciseId } from '@/lib/data/gym-routine-exercises';
import { withDayTiming } from '@/lib/plan/timing';
import type { GeneratedBlock, GeneratedDay, GeneratedItem, GeneratedPlan } from '@/lib/plan/generate';
import type { Equipment } from '@/lib/types';

export const GYM_ROUTINE_SPLIT = 'Gym PPL · 6-session rotation';
export const GYM_ROUTINE_BLOCK_TITLES = [
  'Warmup · Prepare your body',
  'Block 1 · Full-body activation',
  'Block 2 · Build strength',
  'Block 3 · Full-body strength + control',
  'Block 4 · Core stability + abs',
] as const;
export const GYM_EQUIPMENT: Equipment[] = [
  'barbell', 'dumbbell', 'kettlebell', 'machine', 'bodyweight', 'other',
];

export function isGymRoutine(plan: { split: string }): boolean {
  return plan.split === GYM_ROUTINE_SPLIT;
}

function reps(name: string, low: number, high = low, perSide = false, note?: string): GeneratedItem {
  return {
    exercise_id: gymExerciseId(name), sets: 1, reps_low: low, reps_high: high,
    seconds: null, tempo: '2-0-1',
    notes: [perSide ? 'Per side' : null, note].filter(Boolean).join(' · ') || null,
  };
}

/** A timed set always stores the total duration, including both sides. */
function hold(name: string, seconds: number, secondsPerSide?: number): GeneratedItem {
  return {
    exercise_id: gymExerciseId(name), sets: 1, reps_low: 0, reps_high: 0,
    seconds, tempo: null,
    notes: secondsPerSide == null ? null : `${secondsPerSide} seconds per side`,
  };
}

function session(
  name: string,
  focus: string,
  warmups: string[],
  fullBody: GeneratedItem[],
  strength: GeneratedItem[],
  advanced: GeneratedItem[],
  core: GeneratedItem[],
): GeneratedDay {
  const blocks: GeneratedBlock[] = [
    {
      kind: 'warmup', title: GYM_ROUTINE_BLOCK_TITLES[0], rounds: 1, rest_seconds: 0,
      items: warmups.map((exercise, index) => hold(exercise, index === 0 ? 180 : 30)),
    },
    {
      kind: 'circuit', title: GYM_ROUTINE_BLOCK_TITLES[1], rounds: 1, rest_seconds: 30,
      items: fullBody.map((item) => ({ ...item, notes: [item.notes, 'Easy pace; keep the load light'].filter(Boolean).join(' · ') })),
    },
    {
      kind: 'straight', title: GYM_ROUTINE_BLOCK_TITLES[2], rounds: 1, rest_seconds: 90,
      items: strength.map((item) => ({ ...item, sets: 2 })),
    },
    {
      kind: 'circuit', title: GYM_ROUTINE_BLOCK_TITLES[3], rounds: 2, rest_seconds: 45,
      items: advanced.map((item) => ({ ...item, notes: [item.notes, 'Use a light load; keep 2–3 reps available'].filter(Boolean).join(' · ') })),
    },
    {
      kind: 'circuit', title: GYM_ROUTINE_BLOCK_TITLES[4], rounds: 1, rest_seconds: 30,
      items: core,
    },
  ];
  return withDayTiming({ name, focus, blocks });
}

/** The written gym routine: six training sessions, independent of calendar weeks. */
export function generateGymRoutine(): GeneratedPlan {
  return {
    name: 'My gym · 47-minute PPL rotation', split: GYM_ROUTINE_SPLIT, weeks: 6,
    days: [
      session('Push A', 'Push', [
        'Marching with arm swings', 'Squat-to-overhead-reach', 'Standing hip hinge',
        'Alternating reverse lunge', 'Gentle torso rotation',
      ], [
        reps('Bodyweight squat', 10),
        reps('Incline push-up', 8),
        reps('Light bent-over dumbbell row', 10),
        reps('Dead bug', 4, 4, true),
      ], [
        reps('Barbell bench press', 4, 6),
        reps('Seated dumbbell shoulder press', 6, 8),
        reps('Dumbbell lateral raise', 10, 12),
        reps('Lying dumbbell triceps extension', 10, 12),
      ], [
        reps('Dumbbell thruster', 6),
        reps('Reverse lunge, then single-arm dumbbell press', 4, 4, true),
        reps('Push-up to alternating knee drive', 6, 6, false, '6 total; one push-up and one knee drive is one rep'),
        hold('Forward bear crawl', 20),
      ], [
        reps('Bench crunch', 10),
        hold('Forearm plank', 30),
        reps('High-plank shoulder tap', 5, 5, true),
        hold('Side plank', 30, 15),
      ]),
      session('Pull A', 'Pull', [
        'Low-impact step jacks', 'Shoulder rolls', 'Alternating knee hugs',
        'Unweighted good mornings', 'Quadruped thoracic rotations',
      ], [
        reps('Bodyweight reverse lunge', 5, 5, true),
        reps('Light dumbbell floor press', 8),
        reps('Light lat-pulldown machine', 10),
        reps('Reverse crunch', 8),
      ], [
        reps('Pull-up', 4, 6, false, 'If four controlled reps are unavailable, use the lat-pulldown machine for 6–8 reps'),
        reps('Chest-supported dumbbell row', 6, 8),
        reps('Seated row machine', 8, 10, false, 'Use a resistance row machine; if yours is a cardio rower, do a bench-supported one-arm dumbbell row and repeat the listed reps with the left and right arm'),
        reps('Straight-bar barbell curl', 8, 10),
      ], [
        reps('Kettlebell gorilla row', 4, 4, true),
        reps('Renegade row', 4, 4, true, 'Use stable flat-sided dumbbells; with round dumbbells use a hand-on-bench plank row'),
        reps('Single-leg Romanian deadlift to dumbbell row', 4, 4, true),
        hold('Farmer carry', 25),
      ], [
        reps('Hanging knee raise', 8),
        reps('Supine straight-leg lowering', 6),
        reps('Quadruped shoulder tap', 6, 6, true),
        hold('Suitcase hold', 30, 15),
      ]),
      session('Legs A', 'Legs', [
        'Brisk walking in place', 'Ankle rocks', 'Shallow squats with a reach',
        'Lateral steps', 'Arm circles',
      ], [
        reps('Glute bridge', 10),
        reps('Wall push-up', 10),
        reps('Light chest-supported dumbbell row', 8),
        reps('Supine heel tap', 6, 6, true),
      ], [
        reps('Barbell back squat', 4, 6),
        reps('Barbell Romanian deadlift', 6, 8),
        reps('Bulgarian split squat', 6, 6, true),
        reps('Standing dumbbell calf raise', 12),
      ], [
        reps('Dumbbell front-rack walking lunge', 4, 4, true),
        reps('Goblet Cossack squat', 4, 4, true),
        reps('Single-leg Romanian deadlift with opposite-hand dumbbell', 4, 4, true),
        reps('Single-arm kettlebell front squat, stand, then strict press', 3, 3, true),
      ], [
        reps('Bench reverse crunch', 8),
        hold('Long-lever forearm plank', 20),
        hold('Bird dog hold', 30, 15),
        reps('Side-plank hip lift', 5, 5, true),
      ]),
      session('Push B', 'Push', [
        'Alternating heel digs with arm swings', 'Arm sweeps across the chest',
        'Alternating step-back reaches', 'Wall slides', 'Standing hip circles',
      ], [
        reps('Bodyweight lateral lunge', 5, 5, true),
        reps('Kneeling push-up', 8),
        reps('Light seated row machine', 10),
        reps('Bird dog with knee-to-elbow', 4, 4, true),
      ], [
        reps('Incline barbell bench press', 4, 6),
        reps('Parallel-bar dip', 6, 8, false, 'If dips are uncomfortable or six controlled reps are unavailable, use close-grip dumbbell bench press for 8 reps'),
        reps('Seated dumbbell lateral raise', 10, 12),
        reps('Seated overhead dumbbell triceps extension', 10, 12),
      ], [
        reps('Single-arm kettlebell push press', 4, 4, true),
        reps('Plate lateral lunge, then overhead press', 4, 4, true),
        reps('Staggered-hand push-up to shoulder tap', 6, 6, false, '6 total; one push-up and one shoulder tap is one rep'),
        hold('Overhead plate march', 20),
      ], [
        reps('Light plate-weighted curl-up', 10),
        reps('Plank walkout', 4),
        reps('High-plank dumbbell drag', 4, 4, true),
        hold('Offset dumbbell front-rack hold', 30, 15),
      ]),
      session('Pull B', 'Pull', [
        'Side steps with arm swings', 'Standing elbow pullbacks', 'Dynamic hamstring sweep',
        'Walking knee lift', 'Standing diagonal reach',
      ], [
        reps('Bodyweight split squat', 5, 5, true),
        reps('Close-grip incline push-up', 8),
        reps('Light incline-bench dumbbell reverse fly', 8),
        hold('Bent-knee hollow hold', 20),
      ], [
        reps('Chin-up', 4, 6, false, 'If four controlled reps are unavailable, use the lat-pulldown machine for 6–8 reps'),
        reps('Barbell bent-over row', 6, 8),
        reps('Lat-pulldown machine', 8, 10),
        reps('Incline dumbbell curl', 10, 12),
      ], [
        reps('Reverse lunge, then one-arm dumbbell row', 4, 4, true),
        reps('Staggered-stance double-kettlebell deadlift to row', 4, 4, true),
        reps('Bear-plank dumbbell pull-through', 4, 4, true),
        hold('Kettlebell suitcase march', 30, 15),
      ], [
        reps('Seated bench knee tuck', 10),
        reps('Hollow-body rock', 10),
        reps('Dead bug with plate held above chest', 4, 4, true),
        reps('Side plank with top-leg lift', 5, 5, true),
      ]),
      session('Legs B', 'Legs', [
        'Easy low-knee marching', 'Lateral weight shift', 'Heel-to-toe rock',
        'Standing cross-crawl', 'Easy plank-to-downward-dog',
      ], [
        reps('Bodyweight good morning', 10),
        reps('Light neutral-grip dumbbell bench press', 8),
        reps('Light underhand dumbbell row', 8),
        reps('Supine abdominal-braced march', 5, 5, true),
      ], [
        reps('Barbell front squat', 4, 6),
        reps('Barbell hip thrust', 8),
        reps('Dumbbell Romanian deadlift', 8),
        reps('Seated calf raise with dumbbells on thighs', 12),
      ], [
        reps('Reverse lunge with single-arm overhead dumbbell hold', 4, 4, true),
        reps('Dumbbell front-rack lateral lunge', 4, 4, true),
        reps('Two-hand kettlebell swing, if already proficient', 10, 10, false, 'If unfamiliar with swings, use a kettlebell deadlift for 8 reps'),
        reps('Dumbbell squat to alternating overhead press', 6, 6, false, '6 total; one squat and one alternating press is one rep'),
      ], [
        reps('Lying bent-knee leg raise', 8),
        reps('Forearm plank with alternating leg lift', 5, 5, true),
        reps('Floor dumbbell pullover with legs in tabletop', 8),
        reps('Side-plank reach-through', 4, 4, true),
      ]),
    ],
  };
}
