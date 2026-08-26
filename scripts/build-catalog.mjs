/**
 * Builds the exercise catalog from two sources and emits both artifacts the app
 * needs.
 *
 * Emits lib/data/exercises.json: the catalog bundled in the app. The plan
 * generator runs on-device and reads it, so it must work with no network.
 * Postgres deliberately holds no copy -- see the catalog_is_client_side
 * migration.
 *
 * Sources:
 *   free-exercise-db  873 exercises, Unlicense (public domain), 2 stills each
 *   RepDB preview      16 exercises, CC BY-NC 4.0, true animated WebP
 *
 * RepDB wins on id collisions -- its metadata is richer (met, is_unilateral,
 * tips, force_type).
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FEDB_URL =
  'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/dist/exercises.json';
const FEDB_IMG = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises';

/** Equipment tokens the app and onboarding agree on. */
const EQUIPMENT = {
  barbell: 'barbell',
  'e-z curl bar': 'barbell',
  ez_bar: 'barbell',
  dumbbell: 'dumbbell',
  cable: 'cable',
  machine: 'machine',
  smith_machine: 'machine',
  plate_loaded_lateral_raise_machine: 'machine',
  kettlebells: 'kettlebell',
  kettlebell: 'kettlebell',
  bands: 'bands',
  'body only': 'bodyweight',
  pull_up_bar: 'bodyweight',
  'medicine ball': 'other',
  'exercise ball': 'other',
  stability_ball: 'other',
  'foam roll': 'other',
  battle_rope: 'other',
  other: 'other',
};

const LEVEL = { beginner: 'beginner', intermediate: 'intermediate', expert: 'advanced', advanced: 'advanced' };

/**
 * Movement pattern drives which block an exercise can fill. Name keywords are
 * checked before muscle groups because they are far more precise: "romanian
 * deadlift" is a hinge no matter which muscles the dataset tags.
 */
const NAME_PATTERNS = [
  [/\b(back|front|goblet|zercher|hack|box|split)?\s*squat\b/, 'squat'],
  [/\bleg press\b/, 'squat'],
  [/\b(deadlift|good morning|hip thrust|glute bridge|romanian|rdl|hyperextension|back extension|pull.?through)\b/, 'hinge'],
  [/\b(lunge|step.?up|split squat|bulgarian)\b/, 'lunge'],
  [/\b(bench press|push.?up|chest press|chest fly|pec deck|dip)\b/, 'h_push'],
  [/\b(overhead press|shoulder press|military press|push press|handstand|behind the neck press|arnold)\b/, 'v_push'],
  [/\b(row|face pull)\b/, 'h_pull'],
  [/\b(pull.?up|chin.?up|pulldown|pull.?down|lat pull)\b/, 'v_pull'],
  [/\b(curl)\b/, 'biceps'],
  [/\b(tricep|skullcrusher|pushdown|press.?down|kickback|close.?grip bench)\b/, 'triceps'],
  [/\b(lateral raise|front raise|reverse fly|rear delt|upright row)\b/, 'delts'],
  [/\b(calf|calves)\b/, 'calves'],
  [/\b(shrug)\b/, 'traps'],
  [/\b(carry|farmer)\b/, 'carry'],
  [/\b(plank|crunch|sit.?up|leg raise|knee tuck|russian twist|ab wheel|hollow|pull.?in|dead bug|mountain climber)\b/, 'core'],
];

const MUSCLE_PATTERNS = {
  quadriceps: 'squat',
  hamstrings: 'hinge',
  glutes: 'hinge',
  lower_back: 'hinge',
  'lower back': 'hinge',
  chest: 'h_push',
  shoulders: 'v_push',
  lats: 'v_pull',
  'middle back': 'h_pull',
  traps: 'traps',
  biceps: 'biceps',
  triceps: 'triceps',
  abdominals: 'core',
  calves: 'calves',
  forearms: 'forearms',
  abductors: 'hinge',
  adductors: 'lunge',
  neck: 'other',
};

function classifyPattern({ name, category, primaryMuscles }) {
  const lower = name.toLowerCase();
  for (const [re, pattern] of NAME_PATTERNS) if (re.test(lower)) return pattern;
  if (category === 'stretching') return 'mobility';
  if (category === 'cardio' || category === 'plyometrics') return 'conditioning';
  for (const muscle of primaryMuscles ?? []) {
    const hit = MUSCLE_PATTERNS[muscle];
    if (hit) return hit;
  }
  return 'other';
}

/** free-exercise-db ids are directory names; images are `<id>/0.jpg` and `/1.jpg`. */
function fromFedb(raw) {
  const equipment = EQUIPMENT[raw.equipment ?? 'other'] ?? 'other';
  return {
    id: raw.id,
    name: raw.name,
    body_part: raw.primaryMuscles?.[0] ?? 'full_body',
    equipment,
    mechanic: raw.mechanic ?? null,
    force_type: raw.force ?? null,
    level: LEVEL[raw.level] ?? 'beginner',
    is_bodyweight: equipment === 'bodyweight',
    is_unilateral: /\b(one.?arm|single.?leg|single.?arm|one.?leg|alternating)\b/i.test(raw.name),
    met: null,
    primary_muscles: raw.primaryMuscles ?? [],
    secondary_muscles: raw.secondaryMuscles ?? [],
    instructions: raw.instructions ?? [],
    tips: [],
    media_kind: 'crossfade',
    media_refs: {
      start: `${FEDB_IMG}/${raw.images[0]}`,
      end: `${FEDB_IMG}/${raw.images[1] ?? raw.images[0]}`,
    },
    category: raw.category ?? 'strength',
    source: 'fedb',
    pattern: classifyPattern({
      name: raw.name,
      category: raw.category,
      primaryMuscles: raw.primaryMuscles,
    }),
  };
}

function fromRepdb(raw) {
  const equipment = EQUIPMENT[raw.equipment ?? 'body only'] ?? 'bodyweight';
  return {
    id: raw.id,
    name: raw.name_en,
    body_part: raw.body_part,
    equipment: raw.equipment == null ? 'bodyweight' : equipment,
    mechanic: raw.mechanic ?? null,
    force_type: raw.force_type ?? null,
    level: LEVEL[raw.difficulty] ?? 'beginner',
    // RepDB tags pull-up as non-bodyweight because it lists a pull-up bar as
    // equipment. For load maths it plainly is bodyweight, so trust the bar.
    is_bodyweight: raw.is_bodyweight || raw.equipment === 'pull_up_bar' || raw.equipment == null,
    is_unilateral: raw.is_unilateral ?? false,
    met: raw.met ?? null,
    primary_muscles: raw.primary_muscles ?? [],
    secondary_muscles: raw.secondary_muscles ?? [],
    instructions: raw.instructions_en ?? [],
    tips: raw.tips_en ?? [],
    media_kind: 'animated',
    // Resolved against the bundled asset map in lib/media/assets.ts.
    media_refs: { asset: `${raw.id}.webp` },
    category: raw.category ?? 'strength',
    source: 'repdb',
    pattern: classifyPattern({
      name: raw.name_en,
      category: raw.category,
      primaryMuscles: [raw.body_part],
    }),
  };
}

const main = async () => {
  const res = await fetch(FEDB_URL);
  if (!res.ok) throw new Error(`free-exercise-db fetch failed: ${res.status}`);
  const fedb = await res.json();

  const repdb = JSON.parse(
    readFileSync(join(ROOT, 'data/repdb/preview.json'), 'utf8'),
  ).exercises;

  const byId = new Map();
  for (const raw of fedb) byId.set(raw.id, fromFedb(raw));
  let overwritten = 0;
  for (const raw of repdb) {
    if (byId.has(raw.id)) overwritten += 1;
    byId.set(raw.id, fromRepdb(raw));
  }

  const catalog = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));

  mkdirSync(join(ROOT, 'lib/data'), { recursive: true });
  writeFileSync(
    join(ROOT, 'lib/data/exercises.json'),
    JSON.stringify(catalog, null, 0),
  );

  const counts = catalog.reduce((acc, e) => {
    acc[e.pattern] = (acc[e.pattern] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`catalog: ${catalog.length} exercises (${overwritten} RepDB id collisions)`);
  console.log(`animated: ${catalog.filter((e) => e.media_kind === 'animated').length}`);
  console.log('patterns:', counts);
};

main();
