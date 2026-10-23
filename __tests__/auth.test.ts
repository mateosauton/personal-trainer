import { profileGate } from '@/lib/auth-gate';

describe('profileGate', () => {
  it('never treats a failed profile read as a new user', () => {
    expect(profileGate(true, { status: 'error', error: new Error('offline') })).toBe('error');
    expect(profileGate(true, { status: 'ready', profile: null })).toBe('onboarding');
  });
});

// Signed-out users must never enter screens that assert a session.
it.each([
  { status: 'loading' as const },
  { status: 'ready' as const, profile: null },
  { status: 'error' as const, error: new Error('offline') },
])('keeps the signed-out gate closed for $status profile state', (state) => {
  expect(profileGate(false, state)).toBe('signedOut');
});
