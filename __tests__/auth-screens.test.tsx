import type { ReactElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import SignIn from '@/app/(auth)/sign-in';
import ResetPassword from '@/app/reset-password';
import { colors } from '@/lib/theme';

let mockRecovering = false;
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockResetPasswordForEmail = jest.fn();

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View: (props: object) => React.createElement(View, props) },
    ReduceMotion: { System: 'system' },
    useReducedMotion: () => true,
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: (factory: () => object) => factory(),
    withSpring: (value: unknown) => value,
    withTiming: (value: unknown) => value,
  };
});
jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/components/SocialSignInButtons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { SocialSignInButtons: () => React.createElement(Text, null, 'Continue with Google') };
});
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    recoveringPassword: mockRecovering,
    authError: null,
    clearAuthError: jest.fn(),
    signOut: jest.fn(async () => undefined),
    session: null,
  }),
}));
jest.mock('@/lib/db/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      resetPasswordForEmail: (...args: unknown[]) => mockResetPasswordForEmail(...args),
      updateUser: jest.fn(),
    },
  },
}));
jest.mock('@/lib/deep-link', () => ({
  authRedirectTo: () => 'officegym://',
  authRecoveryRedirectTo: () => 'officegym://reset-password',
}));
jest.mock('@/lib/dev-auth', () => ({
  devLoginEnabled: false,
  devLoginEmail: '',
  devSignIn: jest.fn(),
}));
jest.mock('@/lib/social-auth', () => ({
  signInWithSocialProvider: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

const metrics = {
  insets: { top: 20, right: 0, bottom: 0, left: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

function buttonStyle(button: { props: { style?: unknown } }) {
  const style = button.props.style;
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return StyleSheet.flatten(resolved);
}

function renderScreen(node: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>);
}

beforeEach(() => {
  mockRecovering = false;
  mockPush.mockClear();
  mockReplace.mockClear();
  mockResetPasswordForEmail.mockReset();
  mockResetPasswordForEmail.mockResolvedValue({ error: null });
});

describe('sign-in A01', () => {
  it('is an email-first sign-in with the auth olive action', () => {
    renderScreen(<SignIn />);

    expect(screen.getByText('Email sign-in')).toBeTruthy();
    expect(screen.getAllByText('Sign in').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.queryByText('Welcome back.')).toBeNull();
    expect(screen.queryByText(/your plan, your logs/i)).toBeNull();
    expect(screen.queryByText('Continue with Google')).toBeNull();
    expect(colors.accent).toBe('#D7FF3E');

    fireEvent.changeText(screen.getByLabelText('Email'), 'member@officegym.test');
    fireEvent.changeText(screen.getByLabelText('Password'), 'secret1');
    const flat = buttonStyle(screen.getByRole('button', { name: 'Sign in' }));
    expect(flat.backgroundColor).toBe('#58641C');
    expect(flat.backgroundColor).toBe(colors.accentAuth);
    expect(flat.opacity ?? 1).toBe(1);
  });

  it('opens the reset request screen from forgot password', () => {
    renderScreen(<SignIn />);
    fireEvent.press(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(mockPush).toHaveBeenCalledWith('/reset-password');
  });
});

describe('reset-password A10', () => {
  it('asks for an email and sends a reset link when there is no recovery session', async () => {
    renderScreen(<ResetPassword />);

    expect(screen.getByText('Reset password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeTruthy();
    expect(screen.queryByText(/open the password reset link/i)).toBeNull();
    expect(screen.queryByText('Retry sign-in')).toBeNull();
    expect(screen.queryByText('Choose a new password.')).toBeNull();

    fireEvent.changeText(screen.getByLabelText('Email'), 'member@officegym.test');
    const flat = buttonStyle(screen.getByRole('button', { name: 'Send reset link' }));
    expect(flat.backgroundColor).toBe(colors.accentAuth);
    expect(flat.opacity ?? 1).toBe(1);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Send reset link' }));
    });
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith('member@officegym.test', {
      redirectTo: 'officegym://reset-password',
    });
  });

  it('keeps the new-password form for an active recovery session', () => {
    mockRecovering = true;
    renderScreen(<ResetPassword />);
    expect(screen.getByText('Choose a new password.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send reset link' })).toBeNull();
  });
});
