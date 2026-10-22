import { Platform } from 'react-native';
import { signInWithSocialProvider } from '@/lib/social-auth';

const mockOAuth = jest.fn();
const mockIdToken = jest.fn();
const mockComplete = jest.fn();
const mockBrowser = jest.fn();
const mockApple = jest.fn();
const mockDigest = jest.fn();
jest.mock('@/lib/db/supabase', () => ({ supabase: { auth: {
  signInWithOAuth: (...args: unknown[]) => mockOAuth(...args),
  signInWithIdToken: (...args: unknown[]) => mockIdToken(...args),
} } }));
jest.mock('@/lib/deep-link', () => ({
  authRedirectTo: () => 'officegym:///',
  completeAuthFromUrl: (...args: unknown[]) => mockComplete(...args),
}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: (...args: unknown[]) => mockBrowser(...args) }));
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'secure-random-nonce',
  digestStringAsync: (...args: unknown[]) => mockDigest(...args),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
jest.mock('expo-apple-authentication', () => ({
  signInAsync: (...args: unknown[]) => mockApple(...args),
  AppleAuthenticationScope: { EMAIL: 0 },
}));

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  mockOAuth.mockResolvedValue({ data: { url: 'https://project.supabase.co/auth/v1/authorize' }, error: null });
  mockBrowser.mockResolvedValue({ type: 'success', url: 'officegym:///?code=callback' });
  mockComplete.mockResolvedValue(true);
  mockDigest.mockResolvedValue('hashed-nonce');
  mockApple.mockResolvedValue({ identityToken: 'apple-id-token' });
  mockIdToken.mockResolvedValue({ data: { session: {} }, error: null });
});

it.each(['google', 'apple'] as const)('uses the system auth browser for %s on Android', async (provider) => {
  await expect(signInWithSocialProvider(provider)).resolves.toBe(true);
  expect(mockOAuth).toHaveBeenCalledWith({ provider, options: { redirectTo: 'officegym:///', skipBrowserRedirect: true } });
  expect(mockBrowser).toHaveBeenCalledWith('https://project.supabase.co/auth/v1/authorize', 'officegym:///');
  expect(mockComplete).toHaveBeenCalledWith('officegym:///?code=callback');
});

it('redirects the current web tab through Supabase', async () => {
  Platform.OS = 'web';
  await signInWithSocialProvider('google');
  expect(mockOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'officegym:///', skipBrowserRedirect: false } });
  expect(mockBrowser).not.toHaveBeenCalled();
});

it('does not establish a session after browser cancellation', async () => {
  mockBrowser.mockResolvedValue({ type: 'cancel' });
  await expect(signInWithSocialProvider('google')).resolves.toBe(false);
  expect(mockComplete).not.toHaveBeenCalled();
});

it('surfaces disabled providers and does not open the browser', async () => {
  mockOAuth.mockResolvedValue({ data: {}, error: new Error('Provider is not enabled') });
  await expect(signInWithSocialProvider('google')).rejects.toThrow('Provider is not enabled');
  expect(mockBrowser).not.toHaveBeenCalled();
});

it('rejects a callback that did not establish a session', async () => {
  mockComplete.mockResolvedValue(false);
  await expect(signInWithSocialProvider('google')).rejects.toThrow(/sign-in/i);
});

it('exchanges a native Apple token with a hashed request nonce on iOS', async () => {
  Platform.OS = 'ios';
  await expect(signInWithSocialProvider('apple')).resolves.toBe(true);
  expect(mockDigest).toHaveBeenCalledWith('SHA-256', 'secure-random-nonce');
  expect(mockApple).toHaveBeenCalledWith({ requestedScopes: [0], nonce: 'hashed-nonce' });
  expect(mockIdToken).toHaveBeenCalledWith({ provider: 'apple', token: 'apple-id-token', nonce: 'secure-random-nonce' });
  expect(mockOAuth).not.toHaveBeenCalled();
});

it('quietly cancels the native Apple sheet', async () => {
  Platform.OS = 'ios';
  mockApple.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
  await expect(signInWithSocialProvider('apple')).resolves.toBe(false);
  expect(mockIdToken).not.toHaveBeenCalled();
});

it('rejects a missing Apple identity token', async () => {
  Platform.OS = 'ios';
  mockApple.mockResolvedValue({ identityToken: null });
  await expect(signInWithSocialProvider('apple')).rejects.toThrow(/identity token/i);
  expect(mockIdToken).not.toHaveBeenCalled();
});
