import raw from '@/lib/data/exercises.json';
import type { Category, Equipment, Exercise, Pattern } from '@/lib/types';

/**
 * The bundled catalog: 889 exercises merged from free-exercise-db (public
 * domain) and the RepDB preview (CC BY-NC). Built by scripts/build-catalog.mjs.
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
  /** Lowercased substrings; any exercise matching one is dropped. */
  limitations?: string[];
}

const LEVEL_RANK: Record<Exercise['level'], number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

export function candidates(filter: Filter): Exercise[] {
  const max = LEVEL_RANK[filter.level];
  const banned = filter.limitations?.filter(Boolean).map((s) => s.toLowerCase()) ?? [];
  return CATALOG.filter((e) => {
    if (!filter.patterns.includes(e.pattern)) return false;
    if (!filter.equipment.includes(e.equipment)) return false;
    if (LEVEL_RANK[e.level] > max) return false;
    if (filter.categories) {
      if (!filter.categories.includes(e.category)) return false;
    } else if (SPECIALIST.includes(e.category) && filter.level !== 'advanced') {
      return false;
    }
    if (banned.length) {
      const haystack = `${e.name} ${e.primary_muscles.join(' ')} ${e.body_part}`.toLowerCase();
      if (banned.some((b) => haystack.includes(b))) return false;
    }
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
