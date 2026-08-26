import { ANIMATION_ASSETS } from './assets';
import type { Exercise } from '@/lib/types';

/**
 * Two media tiers, one shape. Callers render the result without caring which
 * source an exercise came from:
 *
 *   animated   16 RepDB exercises, a real looping WebP bundled in the app
 *   crossfade  the rest, two public-domain stills faded start <-> end
 */
export type ResolvedMedia =
  | { kind: 'animated'; source: number }
  | { kind: 'crossfade'; start: string; end: string };

export function resolveMedia(exercise: Exercise): ResolvedMedia | null {
  if (exercise.media_kind === 'animated' && 'asset' in exercise.media_refs) {
    const source = ANIMATION_ASSETS[exercise.media_refs.asset];
    // A catalog entry can outlive its asset if the two are regenerated out of
    // step. Fall through to null rather than crashing mid-session.
    if (source !== undefined) return { kind: 'animated', source };
    return null;
  }
  if ('start' in exercise.media_refs) {
    return {
      kind: 'crossfade',
      start: exercise.media_refs.start,
      end: exercise.media_refs.end,
    };
  }
  return null;
}

/** Remote stills worth warming before a block so the first set is not blank. */
export function prefetchUrls(exercises: Exercise[]): string[] {
  const urls: string[] = [];
  for (const exercise of exercises) {
    const media = resolveMedia(exercise);
    if (media?.kind === 'crossfade') urls.push(media.start, media.end);
  }
  return urls;
}
