import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text, Button } from 'react-native';
import { AuthProvider, useAuth } from '@/lib/auth';

const mockSession = jest.fn();
const mockProfile = jest.fn();
const mockCache = jest.fn();
const mockSignOut = jest.fn();
let mockEvent: (event: string, session: any) => void;
let mockLink: (event: { url: string }) => void;
const mockCompleteLink = jest.fn();
const mockAccount = jest.fn();
jest.mock('@/lib/db/supabase', () => ({ supabase: { auth: {
  getSession: (...args: unknown[]) => mockSession(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  onAuthStateChange: (callback: typeof mockEvent) => { mockEvent = callback; return { data: { subscription: { unsubscribe: jest.fn() } } }; },
} } }));
jest.mock('@/lib/db/queries', () => ({ getProfile: (...args: unknown[]) => mockProfile(...args) }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: (...args: unknown[]) => mockCache(...args), setItem: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/session/sync', () => ({ setSyncAccount: (...args: unknown[]) => mockAccount(...args), startOutboxSync: jest.fn(() => jest.fn()) }));
jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn().mockResolvedValue(null),
  addEventListener: (_name: string, callback: typeof mockLink) => { mockLink = callback; return { remove: jest.fn() }; },
}));
jest.mock('@/lib/deep-link', () => ({
  completeAuthFromUrl: (...args: unknown[]) => mockCompleteLink(...args),
  isRecoveryLink: (url: string) => url.includes('reset-password'),
}));
const session = (id: string) => ({ user: { id }, access_token: `token-${id}` });
function Probe() {
  const auth = useAuth();
  return <><Text testID="state">{JSON.stringify({ loading: auth.loading, error: auth.authError?.message, profileStatus: auth.profileState.status, profile: auth.profile?.id, user: auth.session?.user.id, recovery: auth.recoveringPassword, processing: auth.processingAuthLink })}</Text><Button title="retry" onPress={() => { void auth.retrySession(); }} /><Button title="sign out" onPress={() => { void auth.signOut().catch(() => undefined); }} /></>;
}
const mount = () => render(<AuthProvider><Probe /></AuthProvider>);
const state = (screen: ReturnType<typeof mount>) => JSON.parse(screen.getByTestId('state').props.children);
beforeEach(() => {
  jest.clearAllMocks(); mockSession.mockResolvedValue({ data: { session: null }, error: null });
  mockProfile.mockResolvedValue(null); mockCache.mockResolvedValue(null); mockSignOut.mockResolvedValue({ error: null }); mockCompleteLink.mockResolvedValue(true);
});
it('makes a rejected initial session read recoverable', async () => {
  mockSession.mockRejectedValueOnce(new Error('Storage denied'));
  const screen = mount();
  await waitFor(() => expect(state(screen)).toMatchObject({ loading: false, error: 'Storage denied' }));
  await act(async () => { fireEvent.press(screen.getByText('retry')); });
  expect(state(screen)).toMatchObject({ loading: false });
  expect(state(screen).error).toBeUndefined();
});
it('keeps a profile failure recoverable when cache reads also fail', async () => {
  mockSession.mockResolvedValue({ data: { session: session('A') }, error: null });
  mockProfile.mockRejectedValue(new Error('Backend unavailable')); mockCache.mockRejectedValue(new Error('Storage denied'));
  const screen = mount();
  await waitFor(() => expect(state(screen)).toMatchObject({ loading: false, profileStatus: 'error', user: 'A' }));
});
it('ignores a stale initial session result after an auth event', async () => {
  let release!: (value: unknown) => void;
  mockSession.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  const screen = mount();
  await act(async () => { mockEvent('SIGNED_IN', session('B')); });
  await act(async () => { release({ data: { session: session('A') }, error: null }); });
  expect(state(screen).user).toBe('B');
  expect(mockAccount).not.toHaveBeenCalledWith('A');
});
it('clears the old profile synchronously when the account changes', async () => {
  mockSession.mockResolvedValue({ data: { session: session('A') }, error: null });
  mockProfile.mockResolvedValueOnce({ id: 'A', onboarded_at: 'now' });
  const screen = mount();
  await waitFor(() => expect(state(screen).profile).toBe('A'));
  mockProfile.mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => { mockEvent('SIGNED_IN', session('B')); });
  expect(state(screen).profile).toBeUndefined();
  expect(state(screen).profileStatus).toBe('loading');
});
it('shows callback errors and opens recovery for a valid link', async () => {
  const screen = mount();
  await waitFor(() => expect(state(screen).loading).toBe(false));
  mockCompleteLink.mockRejectedValueOnce(new Error('Link expired'));
  await act(async () => { mockLink({ url: 'officegym://reset-password#expired' }); });
  expect(state(screen)).toMatchObject({ error: 'Link expired', recovery: false });
  mockCompleteLink.mockImplementationOnce(async () => { mockEvent('SIGNED_IN', session('A')); return true; });
  await act(async () => { mockLink({ url: 'officegym://reset-password#valid' }); });
  expect(state(screen)).toMatchObject({ user: 'A', recovery: true });
});
it('pauses replay during failed sign-out then restores the real account', async () => {
  mockSession.mockResolvedValue({ data: { session: session('A') }, error: null });
  const screen = mount();
  await waitFor(() => expect(state(screen).user).toBe('A'));
  mockSignOut.mockResolvedValue({ error: new Error('offline') }); mockAccount.mockClear();
  await act(async () => { fireEvent.press(screen.getByText('sign out')); });
  expect(mockAccount.mock.calls.map((call) => call[0])).toEqual([null, 'A']);
});
it('does not expose password reset against A while a B recovery link is pending', async () => {
  mockSession.mockResolvedValue({ data: { session: session('A') }, error: null });
  const screen = mount();
  await waitFor(() => expect(state(screen).user).toBe('A'));
  let release!: (value: boolean) => void;
  mockCompleteLink.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  await act(async () => { mockLink({ url: 'officegym://reset-password#B' }); });
  const exposedDuringExchange = state(screen).recovery;
  expect(state(screen).processing).toBe(true);
  await act(async () => { mockEvent('SIGNED_IN', session('B')); release(true); });
  expect(exposedDuringExchange).toBe(false);
  expect(state(screen)).toMatchObject({ user: 'B', recovery: true });
});
it('restores recovery after a null INITIAL_SESSION during callback exchange', async () => {
  const screen = mount();
  await waitFor(() => expect(state(screen).loading).toBe(false));
  let release!: (value: boolean) => void;
  mockCompleteLink.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  await act(async () => { mockLink({ url: 'officegym://reset-password#A' }); mockEvent('INITIAL_SESSION', null); });
  await act(async () => { mockEvent('SIGNED_IN', session('A')); release(true); });
  expect(state(screen)).toMatchObject({ user: 'A', recovery: true });
});
