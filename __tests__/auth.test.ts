import { profileGate } from '@/lib/auth-gate';

describe('profileGate', () => {
  it('keeps signed-out users outside the ready app', () => {
    expect(profileGate(false, { status: 'ready', profile: null })).toBe('signedOut');
    expect(profileGate(false, { status: 'loading' })).toBe('signedOut');
  });

  it('never treats a failed profile read as a new user', () => {
    expect(profileGate(true, { status: 'error', error: new Error('offline') })).toBe('error');
    expect(profileGate(true, { status: 'ready', profile: null })).toBe('onboarding');
  });
});
