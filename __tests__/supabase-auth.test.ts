const mockCreateClient = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));

it('requires a locally initiated PKCE flow for email authentication', () => {
  const previousEnvironment = process.env.EXPO_PUBLIC_APP_ENV;
  const previousUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;
  process.env.EXPO_PUBLIC_APP_ENV = 'mock';
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.EXPO_PUBLIC_SUPABASE_KEY = 'sb_publishable_LOCAL_TEST_FIXTURE_ONLY';
  try {
    jest.isolateModules(() => { require('@/lib/db/supabase'); });
    expect(mockCreateClient).toHaveBeenCalledWith(
      'http://127.0.0.1:54321',
      'sb_publishable_LOCAL_TEST_FIXTURE_ONLY',
      expect.objectContaining({ auth: expect.objectContaining({ flowType: 'pkce', detectSessionInUrl: false }) }),
    );
  } finally {
    if (previousEnvironment === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
    else process.env.EXPO_PUBLIC_APP_ENV = previousEnvironment;
    if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_KEY;
    else process.env.EXPO_PUBLIC_SUPABASE_KEY = previousKey;
  }
});
