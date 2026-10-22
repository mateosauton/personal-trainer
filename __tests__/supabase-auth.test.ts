const mockCreateClient = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));

it('requires a locally initiated PKCE flow for email authentication', () => {
  const previousUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://audit.example.invalid';
  process.env.EXPO_PUBLIC_SUPABASE_KEY = 'synthetic-publishable-key';
  try {
    jest.isolateModules(() => { require('@/lib/db/supabase'); });
    expect(mockCreateClient).toHaveBeenCalledWith(
      'https://audit.example.invalid',
      'synthetic-publishable-key',
      expect.objectContaining({ auth: expect.objectContaining({ flowType: 'pkce', detectSessionInUrl: false }) }),
    );
  } finally {
    if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_KEY;
    else process.env.EXPO_PUBLIC_SUPABASE_KEY = previousKey;
  }
});
