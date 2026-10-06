import { authRecoveryRedirectTo, completeAuthFromUrl, isRecoveryLink } from '@/lib/deep-link';

const mockExchange = jest.fn();
const mockSetSession = jest.fn();
jest.mock('@/lib/db/supabase', () => ({ supabase: { auth: {
  exchangeCodeForSession: (...args: unknown[]) => mockExchange(...args),
  setSession: (...args: unknown[]) => mockSetSession(...args),
} } }));
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `officegym://${path.replace(/^\//, '')}`,
  parse: (url: string) => {
    const parsed = new URL(url);
    return { hostname: parsed.hostname, path: parsed.pathname.replace(/^\//, ''), queryParams: Object.fromEntries(parsed.searchParams) };
  },
}));
beforeEach(() => { jest.clearAllMocks(); mockExchange.mockResolvedValue({ error: null }); mockSetSession.mockResolvedValue({ error: null }); });
it('uses a dedicated native password-reset callback', () => {
  expect(authRecoveryRedirectTo()).toBe('officegym://reset-password');
  expect(isRecoveryLink('officegym://reset-password?code=test')).toBe(true);
  expect(isRecoveryLink('https://test.example/reset-password?code=test')).toBe(true);
  expect(isRecoveryLink('officegym://#type=recovery&access_token=test')).toBe(true);
  expect(isRecoveryLink('officegym://#type=signup&access_token=test')).toBe(false);
});
it('exchanges a PKCE code and exposes backend errors', async () => {
  await expect(completeAuthFromUrl('officegym://reset-password?code=one')).resolves.toBe(true);
  expect(mockExchange).toHaveBeenCalledWith('one');
  mockExchange.mockResolvedValue({ error: new Error('expired code') });
  await expect(completeAuthFromUrl('officegym://reset-password?code=old')).rejects.toThrow('expired code');
});
it('establishes an implicit session and exposes invalid-token errors', async () => {
  await completeAuthFromUrl('officegym://reset-password#access_token=a&refresh_token=r&type=recovery');
  expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
  mockSetSession.mockResolvedValue({ error: new Error('invalid token') });
  await expect(completeAuthFromUrl('officegym://#access_token=a&refresh_token=r')).rejects.toThrow('invalid token');
});
it('surfaces expired-link errors without trying to sign in', async () => {
  await expect(completeAuthFromUrl('officegym://reset-password#error=access_denied&error_description=Link+expired')).rejects.toThrow('Link expired');
  expect(mockSetSession).not.toHaveBeenCalled();
});
