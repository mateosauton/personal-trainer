import type { Exercise } from '@/lib/types';

/**
 * Every exercise comes from free-exercise-db, which ships two stills per
 * movement: the start and end positions. Crossfading them conveys the
 * movement without needing video or animation assets.
 */
export interface ResolvedMedia {
  start: string;
  end: string;
}

export function resolveMedia(exercise: Exercise): ResolvedMedia | null {
  const { start, end } = exercise.media_refs;
  if (!start) return null;
  return { start, end: end || start };
}

/** Stills worth warming before a session so the first set is not a grey box. */
export function prefetchUrls(exercises: Exercise[]): string[] {
  const urls: string[] = [];
  for (const exercise of exercises) {
    const media = resolveMedia(exercise);
    if (media) urls.push(media.start, media.end);
  }
  return urls;
}
