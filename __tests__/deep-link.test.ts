import { authRedirectTo, completeAuthFromUrl } from '@/lib/deep-link';

const mockExchange = jest.fn();
const mockSetSession = jest.fn();
jest.mock('@/lib/db/supabase', () => ({
  supabase: { auth: {
    exchangeCodeForSession: (...args: unknown[]) => mockExchange(...args),
    setSession: (...args: unknown[]) => mockSetSession(...args),
  } },
}));
jest.mock('expo-linking', () => ({
  createURL: () => 'officegym:///',
  parse: (url: string) => ({ queryParams: Object.fromEntries(new URL(url).searchParams) }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockExchange.mockResolvedValue({ data: { session: {} }, error: null });
  mockSetSession.mockResolvedValue({ data: { session: {} }, error: null });
});

it('exchanges a PKCE code and coalesces browser and Linking callbacks', async () => {
  const url = `${authRedirectTo()}?code=one-use-code`;
  await expect(Promise.all([completeAuthFromUrl(url), completeAuthFromUrl(url)])).resolves.toEqual([true, true]);
  await expect(completeAuthFromUrl(url)).resolves.toBe(true);
  expect(mockExchange).toHaveBeenCalledTimes(1);
  expect(mockExchange).toHaveBeenCalledWith('one-use-code');
});

it('does not adopt an arbitrary session from a legacy implicit link', async () => {
  await expect(completeAuthFromUrl('officegym:///#access_token=access&refresh_token=refresh')).rejects.toThrow(/sign in again/i);
  expect(mockSetSession).not.toHaveBeenCalled();
});

it.each(['https://untrusted.test/?code=stolen', 'officegym:///session/123?code=stolen', 'not a url'])('ignores an unrelated URL %s', async (url) => {
  await expect(completeAuthFromUrl(url)).resolves.toBe(false);
  expect(mockExchange).not.toHaveBeenCalled();
  expect(mockSetSession).not.toHaveBeenCalled();
});

it('surfaces provider callback errors', async () => {
  await expect(completeAuthFromUrl('officegym:///?error=access_denied&error_description=Sign-in+was+denied')).rejects.toThrow('Sign-in was denied');
});

it('surfaces failed exchanges and permits retry', async () => {
  mockExchange.mockResolvedValueOnce({ error: new Error('Expired code') });
  const url = 'officegym:///?code=retry-code';
  await expect(completeAuthFromUrl(url)).rejects.toThrow('Expired code');
  await expect(completeAuthFromUrl(url)).resolves.toBe(true);
  expect(mockExchange).toHaveBeenCalledTimes(2);
});

it('does not adopt an incomplete token callback', async () => {
  await expect(completeAuthFromUrl('officegym:///#access_token=incomplete')).rejects.toThrow(/sign in again/i);
  expect(mockSetSession).not.toHaveBeenCalled();
});
