import type { Profile } from './types';

export type ProfileState =
  | { status: 'loading' }
  | { status: 'ready'; profile: Profile | null }
  | { status: 'error'; error: Error };

export type ProfileGate = 'signedOut' | 'loading' | 'error' | 'onboarding' | 'ready';

/** Keeps an unavailable profile distinct from a genuinely absent profile. */
export function profileGate(signedIn: boolean, state: ProfileState): ProfileGate {
  if (!signedIn) return 'signedOut';
  if (state.status === 'loading') return 'loading';
  if (state.status === 'error') return 'error';
  return state.profile?.onboarded_at != null ? 'ready' : 'onboarding';
}
