import raw from '@/lib/data/exercises.json';
import type { Category, Equipment, Exercise, Pattern } from '@/lib/types';

/**
 * The bundled catalog: 873 exercises from free-exercise-db, public domain
 * under the Unlicense. Built by scripts/build-catalog.mjs.
 */
export const CATALOG = raw as unknown as Exercise[];

const BY_ID = new Map(CATALOG.map((e) => [e.id, e]));

export function getExercise(id: string): Exercise | undefined {
  return BY_ID.get(id);
}

export function exerciseName(id: string): string {
  return BY_ID.get(id)?.name ?? id;
}

/**
 * Competition lifts belong in a competition programme, not in a 45-minute
 * session at the office gym: a snatch or an atlas stone needs coaching and kit
 * this app cannot assume. Advanced users can opt back in.
 */
const SPECIALIST: Category[] = ['strongman', 'olympic weightlifting'];

export interface Filter {
  equipment: Equipment[];
  level: Exercise['level'];
  patterns: Pattern[];
  /** Restrict to these categories; defaults to everything non-specialist. */
  categories?: Category[];
  /** Joint or area keys from onboarding, e.g. 'knee'. */
  limitations?: string[];
}

const LEVEL_RANK: Record<Exercise['level'], number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

/**
 * What a declared limitation actually rules out.
 *
 * Matching the word against names and muscle lists is not enough: nothing in
 * the dataset tags a back squat with "knee", so a knee complaint used to strip
 * out knee circles and leave every squat and lunge standing. Each entry
 * therefore names the muscles that load the joint and the movement patterns
 * built around it.
 */
const LIMITATIONS: Record<string, { muscles: string[]; patterns: Pattern[] }> = {
  shoulders: {
    muscles: ['shoulders', 'chest'],
    patterns: ['v_push', 'delts'],
  },
  'lower back': {
    muscles: ['lower back'],
    patterns: ['hinge', 'carry'],
  },
  knee: {
    muscles: ['quadriceps'],
    patterns: ['squat', 'lunge'],
  },
  neck: {
    muscles: ['neck', 'traps'],
    patterns: ['traps'],
  },
  wrist: {
    muscles: ['forearms'],
    patterns: ['forearms'],
  },
};

function blockedBy(exercise: Exercise, limitations: string[]): boolean {
  for (const raw of limitations) {
    const key = raw.toLowerCase();
    const rule = LIMITATIONS[key];
    if (rule) {
      if (rule.patterns.includes(exercise.pattern)) return true;
      const muscles = [...exercise.primary_muscles, exercise.body_part].map((m) => m.toLowerCase());
      if (rule.muscles.some((m) => muscles.includes(m))) return true;
    }
    // Free-text limitations still fall back to a name match.
    if (exercise.name.toLowerCase().includes(key)) return true;
  }
  return false;
}

export function candidates(filter: Filter): Exercise[] {
  const max = LEVEL_RANK[filter.level];
  const banned = filter.limitations?.filter(Boolean) ?? [];
  return CATALOG.filter((e) => {
    if (!filter.patterns.includes(e.pattern)) return false;
    if (!filter.equipment.includes(e.equipment)) return false;
    if (LEVEL_RANK[e.level] > max) return false;
    if (filter.categories) {
      if (!filter.categories.includes(e.category)) return false;
    } else if (SPECIALIST.includes(e.category) && filter.level !== 'advanced') {
      return false;
    }
    if (banned.length && blockedBy(e, banned)) return false;
    return true;
  });
}

/**
 * Exotic variations -- bands and chains on the bar, deficits, pauses, boards --
 * are peaking tools. They make poor primary lifts for someone whose plan is
 * built from a questionnaire, so they get deprioritised rather than banned.
 */
const VARIATION =
  /\b(bands?|chains?|deficits?|pauses?|boards?|pins?|rack pulls?|floor press|anderson|isometric)\b/i;

export const isPlainLift = (e: Exercise) => !VARIATION.test(e.name);
