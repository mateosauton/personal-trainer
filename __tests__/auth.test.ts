import { profileGate } from '@/lib/auth-gate';

describe('profileGate', () => {
  it('never treats a failed profile read as a new user', () => {
    expect(profileGate(true, { status: 'error', error: new Error('offline') })).toBe('error');
    expect(profileGate(true, { status: 'ready', profile: null })).toBe('onboarding');
  });
});
