import type { Session } from '@supabase/supabase-js';
import { act, render, waitFor } from '@testing-library/react-native';

import { AuthProvider, useAuth } from '@/lib/auth';
import type { Profile } from '@/lib/types';

const mockGetSession = jest.fn();
const mockGetProfile = jest.fn();
const mockGetInitialURL = jest.fn();
const mockCompleteAuthFromUrl = jest.fn();
const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
let mockAuthChange: (event: string, session: Session | null) => void;
let mockURLChange: (event: { url: string }) => void;

jest.mock('@/lib/db/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (callback: typeof mockAuthChange) => {
        mockAuthChange = callback;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
  },
}));

jest.mock('@/lib/db/queries', () => ({ getProfile: (userId: string) => mockGetProfile(userId) }));
jest.mock('@/lib/deep-link', () => ({ completeAuthFromUrl: (url: string) => mockCompleteAuthFromUrl(url) }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => mockGetItem(key),
  setItem: (key: string, value: string) => mockSetItem(key, value),
}));
jest.mock('expo-linking', () => ({
  getInitialURL: () => mockGetInitialURL(),
  addEventListener: (_event: string, callback: typeof mockURLChange) => {
    mockURLChange = callback;
    return { remove: jest.fn() };
  },
}));

type AuthState = ReturnType<typeof useAuth>;
const session = (id: string) => ({ user: { id } }) as Session;
const profile = (id: string) => ({ id, onboarded_at: '2026-10-21T00:00:00Z' }) as Profile;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

function mountAuth() {
  let current!: AuthState;
  const snapshots: AuthState[] = [];
  function Probe() {
    current = useAuth();
    snapshots.push(current);
    return null;
  }
  render(<AuthProvider><Probe /></AuthProvider>);
  return { get current() { return current; }, snapshots };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
  mockGetInitialURL.mockResolvedValue(null);
  mockCompleteAuthFromUrl.mockResolvedValue(false);
  mockGetProfile.mockResolvedValue(null);
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
});

describe('AuthProvider', () => {
  it('releases startup loading and displays a rejected session read', async () => {
    mockGetSession.mockRejectedValueOnce(new Error('Session storage unavailable'));
    const auth = mountAuth();

    await waitFor(() => expect(auth.current.loading).toBe(false));
    expect(auth.current.authError).toBe('Session storage unavailable');
    expect(auth.current.session).toBeNull();
    expect(auth.current.profileState).toEqual({ status: 'ready', profile: null });
  });

  it('displays a Supabase session read error', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: new Error('Session expired') });
    const auth = mountAuth();

    await waitFor(() => expect(auth.current.loading).toBe(false));
    expect(auth.current.authError).toBe('Session expired');
  });

  it('handles failure to read the initial link', async () => {
    mockGetInitialURL.mockRejectedValueOnce(new Error('Could not open sign-in link'));
    const auth = mountAuth();

    await waitFor(() => expect(auth.current.authError).toBe('Could not open sign-in link'));
    expect(auth.current.loading).toBe(false);
  });

  it('displays an initial provider callback error', async () => {
    mockGetInitialURL.mockResolvedValueOnce('officegym://?error=access_denied');
    mockCompleteAuthFromUrl.mockRejectedValueOnce(new Error('Google sign-in was denied'));
    const auth = mountAuth();

    await waitFor(() => expect(auth.current.authError).toBe('Google sign-in was denied'));
    expect(auth.current.loading).toBe(false);
  });

  it('handles callback errors and lets a new attempt clear them', async () => {
    const auth = mountAuth();
    await waitFor(() => expect(auth.current.loading).toBe(false));
    mockCompleteAuthFromUrl.mockRejectedValueOnce(new Error('Apple sign-in failed'));

    act(() => mockURLChange({ url: 'officegym://?code=failed' }));

    await waitFor(() => expect(auth.current.authError).toBe('Apple sign-in failed'));
    act(() => auth.current.clearAuthError());
    expect(auth.current.authError).toBeNull();
  });

  it('never exposes the prior profile while a different account loads', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: session('first') }, error: null });
    mockGetProfile.mockResolvedValueOnce(profile('first'));
    const nextProfile = deferred<Profile | null>();
    mockGetProfile.mockReturnValueOnce(nextProfile.promise);
    const auth = mountAuth();
    await waitFor(() => expect(auth.current.profile?.id).toBe('first'));

    act(() => mockAuthChange('SIGNED_IN', session('second')));

    expect(auth.snapshots.filter((state) => state.session?.user.id === 'second').every((state) => state.profile === null)).toBe(true);
    expect(auth.current.loading).toBe(true);
    await act(async () => nextProfile.resolve(profile('second')));
    expect(auth.current.profile?.id).toBe('second');
  });

  it('clears a loading profile immediately when signing out', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: session('first') }, error: null });
    const pending = deferred<Profile | null>();
    mockGetProfile.mockReturnValueOnce(pending.promise);
    const auth = mountAuth();
    await waitFor(() => expect(mockGetProfile).toHaveBeenCalledWith('first'));

    act(() => mockAuthChange('SIGNED_OUT', null));
    expect(auth.current.loading).toBe(false);
    expect(auth.current.profileState).toEqual({ status: 'ready', profile: null });

    await act(async () => pending.resolve(profile('first')));
    expect(auth.current.profile).toBeNull();
  });

  it('does not let a delayed startup read replace a newer auth event', async () => {
    const startup = deferred<{ data: { session: Session | null }; error: null }>();
    mockGetSession.mockReturnValueOnce(startup.promise);
    mockGetProfile.mockResolvedValueOnce(profile('second'));
    const auth = mountAuth();

    await act(async () => mockAuthChange('SIGNED_IN', session('second')));
    await waitFor(() => expect(auth.current.profile?.id).toBe('second'));
    await act(async () => startup.resolve({ data: { session: null }, error: null }));

    expect(auth.current.session?.user.id).toBe('second');
    expect(auth.current.profile?.id).toBe('second');
  });

  it('uses the matching cached profile when the server is unavailable', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: session('first') }, error: null });
    mockGetProfile.mockRejectedValueOnce(new Error('Offline'));
    mockGetItem.mockResolvedValueOnce(JSON.stringify(profile('first')));
    const auth = mountAuth();

    await waitFor(() => expect(auth.current.loading).toBe(false));
    expect(auth.current.profile?.id).toBe('first');
    expect(mockGetItem).toHaveBeenCalledWith('office-gym.profile.first');
  });

  it('finishes loading even when the server and cache both fail', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: session('first') }, error: null });
    mockGetProfile.mockRejectedValueOnce(new Error('Offline'));
    mockGetItem.mockRejectedValueOnce(new Error('Storage unavailable'));
    const auth = mountAuth();

    await waitFor(() => expect(auth.current.loading).toBe(false));
    expect(auth.current.profileState).toEqual({ status: 'error', error: new Error('Offline') });
  });

  it('keeps a loaded profile usable when caching fails', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: session('first') }, error: null });
    mockGetProfile.mockResolvedValueOnce(profile('first'));
    mockSetItem.mockRejectedValueOnce(new Error('Storage unavailable'));
    const auth = mountAuth();

    await waitFor(() => expect(auth.current.loading).toBe(false));
    expect(auth.current.profile?.id).toBe('first');
  });

  it('discards a pending profile refresh after the account changes', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: session('first') }, error: null });
    mockGetProfile.mockResolvedValueOnce(profile('first'));
    const auth = mountAuth();
    await waitFor(() => expect(auth.current.profile?.id).toBe('first'));
    const refresh = deferred<Profile | null>();
    mockGetProfile.mockReturnValueOnce(refresh.promise).mockResolvedValueOnce(profile('second'));
    let refreshing!: Promise<void>;
    act(() => { refreshing = auth.current.refreshProfile(); });
    await act(async () => mockAuthChange('SIGNED_IN', session('second')));
    await waitFor(() => expect(auth.current.profile?.id).toBe('second'));

    await act(async () => { refresh.resolve(profile('first')); await refreshing; });

    expect(auth.current.profile?.id).toBe('second');
  });
});
