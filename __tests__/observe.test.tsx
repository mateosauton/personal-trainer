import { render, waitFor } from '@testing-library/react-native';

const mockMarkInteractive = jest.fn();
const mockUseObserve = jest.fn(() => ({ markInteractive: mockMarkInteractive }));
const signedOutState = {
  session: null,
  profileState: { status: 'idle' },
  loading: false,
  refreshProfile: jest.fn(),
  signOut: jest.fn(),
};
const mockAuthState: { value: typeof signedOutState | Record<string, unknown> } = { value: signedOutState };
const mockUseAuth = jest.fn(() => mockAuthState.value);

jest.mock('expo-observe', () => ({
  ObserveRoot: {
    wrap: (Component: React.ComponentType) => (props: object) => {
      const { createElement } = require('react');
      return createElement(Component, props);
    },
  },
  useObserve: mockUseObserve,
}), { virtual: true });

jest.mock('@/lib/auth', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: mockUseAuth,
}));

jest.mock('@/lib/session/sync', () => ({ startOutboxSync: jest.fn() }));

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return { GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('expo-router', () => {
  const { View } = require('react-native');
  const Stack = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Stack.Protected = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Stack.Screen = () => null;
  return { Stack };
});

const RootLayout = require('@/app/_layout').default;

describe('Expo Observe', () => {
  beforeEach(() => {
    mockMarkInteractive.mockClear();
    mockAuthState.value = signedOutState;
  });

  it('marks the signed-out entry route interactive', async () => {
    render(<RootLayout />);

    await waitFor(() => expect(mockMarkInteractive).toHaveBeenCalledTimes(1));
  });

  it('does not mark interactive while a signed-in profile is loading', () => {
    mockAuthState.value = {
      ...signedOutState,
      session: {},
      profileState: { status: 'loading' },
    };

    render(<RootLayout />);

    expect(mockMarkInteractive).not.toHaveBeenCalled();
  });
});

it('waits to mark interactive while a recovery link is being verified', () => {
  mockMarkInteractive.mockClear();
  mockAuthState.value = { ...signedOutState, processingAuthLink: true };
  render(<RootLayout />);
  expect(mockMarkInteractive).not.toHaveBeenCalled();
});
