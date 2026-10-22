import { authRecoveryRedirectTo, completeAuthFromUrl, isRecoveryLink } from '@/lib/deep-link';

const mockExchange = jest.fn();
const mockSetSession = jest.fn();
const mockGetSession = jest.fn();
const mockCreateURL = jest.fn();
jest.mock('@/lib/db/supabase', () => ({ supabase: { auth: {
  exchangeCodeForSession: (...args: unknown[]) => mockExchange(...args),
  setSession: (...args: unknown[]) => mockSetSession(...args),
  getSession: (...args: unknown[]) => mockGetSession(...args),
} } }));
jest.mock('expo-linking', () => ({
  createURL: (...args: unknown[]) => mockCreateURL(...args),
  parse: (url: string) => {
    const parsed = new URL(url);
    return { hostname: parsed.hostname, path: parsed.pathname.replace(/^\//, ''), queryParams: Object.fromEntries(parsed.searchParams) };
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockCreateURL.mockImplementation((path: string) => `officegym://${path.replace(/^\//, '')}`);
  mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
  mockExchange.mockResolvedValue({ error: null });
  mockSetSession.mockResolvedValue({ error: null });
});

it('recognizes only the configured password-reset callback route', () => {
  expect(authRecoveryRedirectTo()).toBe('officegym://reset-password');
  expect(isRecoveryLink('officegym://reset-password?code=test')).toBe(true);
  expect(isRecoveryLink('https://other.example/reset-password?code=test')).toBe(false);
  expect(isRecoveryLink('officegym://?type=recovery')).toBe(false);
  expect(isRecoveryLink('officegym://#type=recovery')).toBe(false);
});

it('exchanges a signed-out PKCE callback and exposes backend errors', async () => {
  await expect(completeAuthFromUrl('officegym://reset-password?code=one')).resolves.toBe(true);
  expect(mockExchange).toHaveBeenCalledWith('one');
  mockExchange.mockResolvedValue({ error: new Error('expired code') });
  await expect(completeAuthFromUrl('officegym://reset-password?code=old')).rejects.toThrow('expired code');
});

it.each(['officegym://', 'officegym:///'])('accepts native root callback %s', async (root) => {
  await expect(completeAuthFromUrl(`${root}?code=signup`)).resolves.toBe(true);
  expect(mockExchange).toHaveBeenCalledWith('signup');
});

it.each([null, { user: { id: 'current-account' } }])('rejects implicit tokens before any authentication mutation', async (session) => {
  mockGetSession.mockResolvedValue({ data: { session }, error: null });
  await expect(completeAuthFromUrl('officegym://#access_token=synthetic&refresh_token=synthetic')).rejects.toThrow(/new email link/i);
  expect(mockSetSession).not.toHaveBeenCalled();
  expect(mockExchange).not.toHaveBeenCalled();
});

it('does not exchange an email code over an existing signed-in session', async () => {
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'current-account' } } }, error: null });
  await expect(completeAuthFromUrl('officegym://reset-password?code=other-account')).rejects.toThrow(/sign out.*new email link/i);
  expect(mockExchange).not.toHaveBeenCalled();
  expect(mockSetSession).not.toHaveBeenCalled();
});

it.each([
  'officegym:?code=one',
  'officegym://unrelated/path?code=one',
  'officegym://reset-password:1234?code=one',
  'officegym://user@reset-password?code=one',
  'officegym://reset-password/extra?code=one',
  'https://other.example/reset-password?code=one',
  'officegym://reset-password?code=one&code=two',
  'officegym://reset-password?code=one#code=two',
  'officegym://reset-password?code=one&access_token=synthetic',
  'officegym://reset-password?code=one#refresh_token=synthetic',
])('rejects an unapproved or ambiguous callback: %s', async (url) => {
  await expect(completeAuthFromUrl(url)).rejects.toThrow();
  expect(mockExchange).not.toHaveBeenCalled();
  expect(mockSetSession).not.toHaveBeenCalled();
});

it.each([
  ['https://trainer.example/Personal-Trainer/', 'https://trainer.example/Personal-Trainer/reset-password'],
  ['exp://192.0.2.1:8081/--/', 'exp://192.0.2.1:8081/--/reset-password'],
])('uses the callback roots generated for this runtime: %s', async (root, recovery) => {
  mockCreateURL.mockImplementation((path: string) => path === '/' ? root : recovery);
  await expect(completeAuthFromUrl(`${root}?code=signup`)).resolves.toBe(true);
  await expect(completeAuthFromUrl(`${recovery}?code=reset`)).resolves.toBe(true);
  expect(isRecoveryLink(`${recovery}?code=reset`)).toBe(true);
  expect(isRecoveryLink(`${root}?code=signup&type=recovery`)).toBe(false);
});

it.each([
  'https://other.example/Personal-Trainer/reset-password?code=one',
  'https://trainer.example:444/Personal-Trainer/reset-password?code=one',
  'https://user@trainer.example/Personal-Trainer/reset-password?code=one',
  'https://trainer.example/reset-password?code=one',
  'https://trainer.example/Personal-Trainer/reset-password/extra?code=one',
])('rejects web origin and path confusion: %s', async (url) => {
  mockCreateURL.mockImplementation((path: string) => `https://trainer.example/Personal-Trainer${path}`);
  await expect(completeAuthFromUrl(url)).rejects.toThrow();
  expect(mockExchange).not.toHaveBeenCalled();
});

it('preserves expected Expo callback query values', async () => {
  mockCreateURL.mockImplementation((path: string) => `exp://192.0.2.1:8081/--${path}?release-channel=preview`);
  await expect(completeAuthFromUrl('exp://192.0.2.1:8081/--/?release-channel=preview&code=one')).resolves.toBe(true);
  mockExchange.mockClear();
  await expect(completeAuthFromUrl('exp://192.0.2.1:8081/--/?release-channel=other&code=one')).rejects.toThrow();
  expect(mockExchange).not.toHaveBeenCalled();
});

it('fails closed if the existing session cannot be checked', async () => {
  mockGetSession.mockResolvedValue({ data: { session: null }, error: new Error('Storage unavailable') });
  await expect(completeAuthFromUrl('officegym://?code=one')).rejects.toThrow('Storage unavailable');
  expect(mockExchange).not.toHaveBeenCalled();
});

it('surfaces missing verifier errors without falling back to token imports', async () => {
  mockExchange.mockResolvedValue({ error: new Error('PKCE code verifier missing') });
  await expect(completeAuthFromUrl('officegym://?code=unsolicited')).rejects.toThrow('PKCE code verifier missing');
  expect(mockSetSession).not.toHaveBeenCalled();
});

it('ignores ordinary startup and navigation links', async () => {
  await expect(completeAuthFromUrl('officegym://')).resolves.toBe(false);
  await expect(completeAuthFromUrl('officegym://session/day-id')).resolves.toBe(false);
  expect(mockGetSession).not.toHaveBeenCalled();
  expect(mockExchange).not.toHaveBeenCalled();
});

it('surfaces expired-link errors without trying to sign in', async () => {
  await expect(completeAuthFromUrl('officegym://reset-password#error=access_denied&error_description=Link+expired')).rejects.toThrow('Link expired');
  expect(mockSetSession).not.toHaveBeenCalled();
  expect(mockExchange).not.toHaveBeenCalled();
});
