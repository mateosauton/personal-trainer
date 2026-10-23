const mockCreateClient = jest.fn();
jest.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => mockCreateClient(...args) }));
jest.mock('@react-native-async-storage/async-storage', () => ({}));

const names = ['EXPO_PUBLIC_APP_ENV', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_KEY', 'EXPO_PUBLIC_DEV_LOGIN_EMAIL', 'EXPO_PUBLIC_DEV_LOGIN_PASSWORD', 'EXPO_PUBLIC_ALLOW_DEV_LOGIN'] as const;
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  names.forEach((name) => delete process.env[name]);
  mockCreateClient.mockClear();
});
afterEach(() => names.forEach((name) => {
  if (previous[name] === undefined) delete process.env[name];
  else process.env[name] = previous[name];
}));

it.each([
  ['production', 'https://example.supabase.co', 'sb_publishable_synthetic_public_key_for_checks'],
  ['development', 'https://asbudyijvunpnhrhsubm.supabase.co', 'sb_publishable_synthetic_public_key_for_checks'],
  ['production', 'https://asbudyijvunpnhrhsubm.supabase.co', 'sb_secret_privileged_key'],
  [undefined, 'https://asbudyijvunpnhrhsubm.supabase.co', 'sb_publishable_synthetic_public_key_for_checks'],
])('rejects unsafe runtime configuration before creating a client (%s)', (environment, url, key) => {
  if (environment) process.env.EXPO_PUBLIC_APP_ENV = environment;
  process.env.EXPO_PUBLIC_SUPABASE_URL = url;
  process.env.EXPO_PUBLIC_SUPABASE_KEY = key;
  expect(() => jest.isolateModules(() => { require('@/lib/db/supabase'); })).toThrow();
  expect(mockCreateClient).not.toHaveBeenCalled();
});

it('rejects public developer credentials even when the backend and environment are production', () => {
  process.env.EXPO_PUBLIC_APP_ENV = 'production';
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://asbudyijvunpnhrhsubm.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_KEY = 'sb_publishable_synthetic_public_key_for_checks';
  process.env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD = 'test-password-never-distribute';
  expect(() => jest.isolateModules(() => { require('@/lib/db/supabase'); })).toThrow(/credentials/);
  expect(mockCreateClient).not.toHaveBeenCalled();
});

it('rejects mock and local backends in a production JavaScript runtime', () => {
  const previousDev = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: false });
  try {
    for (const environment of ['mock', 'local']) {
      process.env.EXPO_PUBLIC_APP_ENV = environment;
      process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
      process.env.EXPO_PUBLIC_SUPABASE_KEY = environment === 'mock' ? 'sb_publishable_LOCAL_TEST_FIXTURE_ONLY' : 'sb_publishable_synthetic_public_key_for_checks';
      expect(() => jest.isolateModules(() => { require('@/lib/db/supabase'); })).toThrow();
    }
    expect(mockCreateClient).not.toHaveBeenCalled();
  } finally {
    if (previousDev) Object.defineProperty(globalThis, '__DEV__', previousDev);
    else Reflect.deleteProperty(globalThis, '__DEV__');
  }
});
