const mockSignInWithPassword = jest.fn();

jest.mock('@/lib/db/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
    },
  },
}));

const approvedEmail = 'sautonmateo@gmail.com';
const credentials = {
  EXPO_PUBLIC_DEV_LOGIN_EMAIL: approvedEmail,
  EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'test-password',
};

function loadDevAuth(env: Record<string, string | undefined>, development = true) {
  const previousEnv = process.env;
  const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
  const previousDevelopment = runtime.__DEV__;
  process.env = {
    ...previousEnv,
    EXPO_PUBLIC_ALLOW_DEV_LOGIN: undefined,
    EXPO_PUBLIC_DEV_LOGIN_EMAIL: undefined,
    EXPO_PUBLIC_DEV_LOGIN_PASSWORD: undefined,
    ...env,
  };
  runtime.__DEV__ = development;
  try {
    let mod!: typeof import('@/lib/dev-auth');
    jest.isolateModules(() => {
      mod = jest.requireActual('@/lib/dev-auth');
    });
    return mod;
  } finally {
    process.env = previousEnv;
    runtime.__DEV__ = previousDevelopment;
  }
}

beforeEach(() => {
  mockSignInWithPassword.mockReset().mockResolvedValue({ error: null });
});

describe('development sign-in security', () => {
  it.each([
    {},
    { EXPO_PUBLIC_DEV_LOGIN_EMAIL: approvedEmail },
    { EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'test-password' },
  ])('rejects missing credentials: %j', async (env) => {
    const auth = loadDevAuth(env);
    expect(auth.devLoginEnabled).toBe(false);
    await expect(auth.devSignIn()).rejects.toThrow(/not available/);
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it('rejects an address outside the whitelist without attempting authentication', async () => {
    const auth = loadDevAuth({
      ...credentials,
      EXPO_PUBLIC_DEV_LOGIN_EMAIL: 'someone-else@example.com',
    });
    expect(auth.devLoginEnabled).toBe(false);
    await expect(auth.devSignIn()).rejects.toThrow(/not available/);
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it('authenticates approved credentials through Supabase in a development build', async () => {
    const auth = loadDevAuth(credentials);
    expect(auth.devLoginEnabled).toBe(true);
    await auth.devSignIn();
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: approvedEmail,
      password: 'test-password',
    });
  });

  it('refuses production sign-in without an explicit opt-in even with approved credentials', async () => {
    const auth = loadDevAuth(credentials, false);
    expect(auth.devLoginEnabled).toBe(false);
    await expect(auth.devSignIn()).rejects.toThrow(/not available/);
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });

  it('requires the exact opt-in flag to enable approved credentials outside development', () => {
    expect(loadDevAuth({ ...credentials, EXPO_PUBLIC_ALLOW_DEV_LOGIN: 'true' }, false).devLoginEnabled).toBe(false);
    expect(loadDevAuth({ ...credentials, EXPO_PUBLIC_ALLOW_DEV_LOGIN: '1' }, false).devLoginEnabled).toBe(true);
  });

  it('propagates failed authentication instead of treating it as a signed-in session', async () => {
    mockSignInWithPassword.mockResolvedValue({ error: new Error('Invalid credentials') });
    await expect(loadDevAuth(credentials).devSignIn()).rejects.toThrow('Invalid credentials');
  });
});
