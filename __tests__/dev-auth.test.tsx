import { act, fireEvent, render } from '@testing-library/react-native';

import SignIn from '@/app/(auth)/sign-in';

const mockSignInWithPassword = jest.fn().mockResolvedValue({ error: null });
const mockDevSignIn = jest.fn().mockResolvedValue(undefined);
/** Flipped per test; the screen reads the flag through the mocked module. */
const mockGate = { enabled: false };

jest.mock('@/lib/db/supabase', () => ({
  supabase: { auth: { signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args) } },
}));

jest.mock('@/lib/deep-link', () => ({ authRedirectTo: () => 'exp://redirect' }));

jest.mock('@/lib/dev-auth', () => ({
  get devLoginEnabled() {
    return mockGate.enabled;
  },
  devLoginEmail: 'sautonmateo@gmail.com',
  devSignIn: (...args: unknown[]) => mockDevSignIn(...args),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

/** The real module reads the environment once, at import. */
const loadDevAuth = (env: Record<string, string | undefined>) => {
  const previous = { ...process.env };
  Object.assign(process.env, env);
  let mod!: typeof import('@/lib/dev-auth');
  jest.isolateModules(() => {
    mod = jest.requireActual('@/lib/dev-auth');
  });
  process.env = previous;
  return mod;
};

describe('dev sign-in gate', () => {
  it('is off without credentials', () => {
    const mod = loadDevAuth({
      EXPO_PUBLIC_DEV_LOGIN_EMAIL: undefined,
      EXPO_PUBLIC_DEV_LOGIN_PASSWORD: undefined,
    });
    expect(mod.devLoginEnabled).toBe(false);
  });

  it('refuses an address that is not whitelisted', () => {
    const mod = loadDevAuth({
      EXPO_PUBLIC_DEV_LOGIN_EMAIL: 'someone-else@example.com',
      EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'hunter2',
    });
    expect(mod.devLoginEnabled).toBe(false);
  });

  it('turns on for the whitelisted address with both credentials set', () => {
    const mod = loadDevAuth({
      EXPO_PUBLIC_DEV_LOGIN_EMAIL: 'sautonmateo@gmail.com',
      EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'hunter2',
    });
    expect(mod.devLoginEnabled).toBe(true);
  });

  it('will not sign in when the gate is closed', async () => {
    const mod = loadDevAuth({
      EXPO_PUBLIC_DEV_LOGIN_EMAIL: 'someone-else@example.com',
      EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'hunter2',
    });
    await expect(mod.devSignIn()).rejects.toThrow(/not available/);
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });
});

describe('sign-in screen', () => {
  it('shows no dev button when the gate is closed', () => {
    mockGate.enabled = false;
    const { queryByLabelText } = render(<SignIn />);
    expect(queryByLabelText('Sign in with the test account')).toBeNull();
  });

  it('offers the shortcut when the gate is open', async () => {
    mockGate.enabled = true;
    const { getByLabelText } = render(<SignIn />);
    await act(async () => {
      fireEvent.press(getByLabelText('Sign in with the test account'));
    });
    expect(mockDevSignIn).toHaveBeenCalled();
  });
});

describe('return key', () => {
  beforeEach(() => {
    mockGate.enabled = false;
    mockSignInWithPassword.mockClear();
  });

  it('signs in from the password field, like tapping the button', async () => {
    const { getByPlaceholderText } = render(<SignIn />);

    fireEvent.changeText(getByPlaceholderText('Email'), 'a@example.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'hunter2');
    await act(async () => {
      fireEvent(getByPlaceholderText('Password'), 'submitEditing');
    });

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'a@example.com',
      password: 'hunter2',
    });
  });

  it('does nothing while the form is not submittable', async () => {
    const { getByPlaceholderText } = render(<SignIn />);

    fireEvent.changeText(getByPlaceholderText('Email'), 'a@example.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'short');
    await act(async () => {
      fireEvent(getByPlaceholderText('Password'), 'submitEditing');
    });

    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });
});
