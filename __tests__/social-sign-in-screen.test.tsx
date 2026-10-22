import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import SignIn from '@/app/(auth)/sign-in';
import { SocialSignInButtons } from '@/components/SocialSignInButtons';

const mockSocialSignIn = jest.fn();
const mockPasswordSignIn = jest.fn();
const mockDevSignIn = jest.fn();
const mockAppleAvailable = jest.fn();
const mockClearAuthError = jest.fn();
const mockAuth = { authError: null as string | null };

jest.mock('@/lib/social-auth', () => ({
  signInWithSocialProvider: (...args: unknown[]) => mockSocialSignIn(...args),
}));

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ ...mockAuth, clearAuthError: mockClearAuthError }),
}));

jest.mock('@/lib/db/supabase', () => ({
  supabase: { auth: { signInWithPassword: (...args: unknown[]) => mockPasswordSignIn(...args) } },
}));

jest.mock('@/lib/deep-link', () => ({ authRedirectTo: () => 'officegym://auth/callback' }));
jest.mock('@/lib/dev-auth', () => ({
  devLoginEnabled: true,
  devLoginEmail: 'test@example.com',
  devSignIn: () => mockDevSignIn(),
}));

jest.mock('expo-apple-authentication', () => {
  const { Pressable, Text } = require('react-native');
  return {
    isAvailableAsync: () => mockAppleAvailable(),
    AppleAuthenticationButtonType: { CONTINUE: 1 },
    AppleAuthenticationButtonStyle: { WHITE: 1 },
    AppleAuthenticationButton: (props: Record<string, unknown>) => (
      <Pressable {...props} accessibilityRole="button" accessibilityLabel="Continue with Apple" testID="native-apple-button">
        <Text>Continue with Apple</Text>
      </Pressable>
    ),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

describe('social sign-in screen', () => {
  const originalOS = Platform.OS;
  const originalGoogleEnabled = process.env.EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED;
  const originalAppleEnabled = process.env.EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED = '1';
    process.env.EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED = '1';
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    mockSocialSignIn.mockResolvedValue(true);
    mockPasswordSignIn.mockResolvedValue({ error: null });
    mockDevSignIn.mockResolvedValue(undefined);
    mockAppleAvailable.mockResolvedValue(true);
    mockAuth.authError = null;
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    if (originalGoogleEnabled === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED;
    else process.env.EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED = originalGoogleEnabled;
    if (originalAppleEnabled === undefined) delete process.env.EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED;
    else process.env.EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED = originalAppleEnabled;
  });

  it.each(['web', 'android', 'ios'])('defaults to email without social providers on %s', async (platform) => {
    delete process.env.EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED;
    delete process.env.EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED;
    Object.defineProperty(Platform, 'OS', { value: platform, configurable: true });
    const screen = render(<SignIn />);
    await act(async () => {});

    expect(screen.queryByRole('button', { name: 'Continue with Apple' })).toBeNull();
    expect(mockAppleAvailable).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
    expect(screen.getByPlaceholderText('Email')).toBeTruthy();
    expect(screen.getByPlaceholderText('Password')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Create an account'));
    expect(screen.queryByRole('button', { name: 'Continue with Apple' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy();
  });

  it('renders no provider group when neither provider is enabled', () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED;
    delete process.env.EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED;
    const screen = render(<SocialSignInButtons disabled={false} loading={null} onPress={mockSocialSignIn} />);
    expect(screen.toJSON()).toBeNull();
  });

  it('offers Google when explicitly enabled while Apple remains disabled', async () => {
    delete process.env.EXPO_PUBLIC_APPLE_SIGN_IN_ENABLED;
    const screen = render(<SignIn />);
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Continue with Google' }));
    });
    expect(mockSocialSignIn).toHaveBeenCalledWith('google');
    expect(screen.queryByRole('button', { name: 'Continue with Apple' })).toBeNull();
    expect(mockAppleAvailable).not.toHaveBeenCalled();
  });

  it.each(['Google', 'Apple'])('starts %s sign-in from the provider button', async (provider) => {
    const screen = render(<SignIn />);
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: `Continue with ${provider}` }));
    });
    expect(mockSocialSignIn).toHaveBeenCalledWith(provider.toLowerCase());
  });

  it('offers both providers while creating an account', async () => {
    const screen = render(<SignIn />);
    fireEvent.press(screen.getByLabelText('Create an account'));
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Continue with Google' }));
    });
    expect(mockSocialSignIn).toHaveBeenCalledWith('google');
    expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeTruthy();
  });

  it('locks competing actions until the social attempt finishes, then permits retry', async () => {
    let finish!: (result: boolean) => void;
    mockSocialSignIn.mockReturnValueOnce(new Promise<boolean>((resolve) => { finish = resolve; }));
    const screen = render(<SignIn />);
    fireEvent.changeText(screen.getByPlaceholderText('Email'), 'a@example.com');
    fireEvent.changeText(screen.getByPlaceholderText('Password'), 'hunter2');
    fireEvent.press(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(screen.getByPlaceholderText('Email')).toHaveProp('editable', false);
    expect(screen.getByPlaceholderText('Password')).toHaveProp('editable', false);
    fireEvent.press(screen.getByRole('button', { name: 'Continue with Apple' }));
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.press(screen.getByLabelText('Create an account'));
    fireEvent.press(screen.getByLabelText('Sign in with the test account'));
    expect(mockSocialSignIn).toHaveBeenCalledTimes(1);
    expect(mockPasswordSignIn).not.toHaveBeenCalled();
    expect(mockDevSignIn).not.toHaveBeenCalled();
    expect(screen.queryByText('Create account')).toBeNull();

    await act(async () => { finish(false); });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Continue with Apple' }));
    });
    expect(mockSocialSignIn).toHaveBeenLastCalledWith('apple');
    expect(screen.getByPlaceholderText('Email')).toHaveProp('editable', true);
  });

  it('keeps cancellation quiet and displays provider errors with a working retry', async () => {
    mockSocialSignIn.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('Google sign-in is unavailable'));
    const screen = render(<SignIn />);
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Continue with Google' })); });
    expect(screen.queryByText(/failed|unavailable/i)).toBeNull();
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Continue with Google' })); });
    expect(screen.getByText('Google sign-in is unavailable')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Continue with Google' })); });
    expect(mockSocialSignIn).toHaveBeenCalledTimes(3);
    expect(screen.queryByText('Google sign-in is unavailable')).toBeNull();
  });

  it('displays callback errors supplied by the auth provider', () => {
    mockAuth.authError = 'The sign-in link expired. Please try again.';
    const screen = render(<SignIn />);
    expect(screen.getByText(mockAuth.authError)).toBeTruthy();
  });

  it('uses the native Apple button on supported iOS devices', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const screen = render(<SignIn />);
    await waitFor(() => expect(screen.getByTestId('native-apple-button')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByTestId('native-apple-button')); });
    expect(mockAppleAvailable).toHaveBeenCalled();
    expect(mockSocialSignIn).toHaveBeenCalledWith('apple');
  });

  it('hides Apple on iOS when native sign-in is unavailable', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    mockAppleAvailable.mockResolvedValue(false);
    const screen = render(<SignIn />);
    await act(async () => {});
    expect(mockAppleAvailable).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Continue with Apple' })).toBeNull();
  });
});
