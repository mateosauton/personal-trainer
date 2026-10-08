import { render } from '@testing-library/react-native';

const signedOutState = {
  session: null,
  profileState: { status: 'idle' },
  loading: false,
  refreshProfile: jest.fn(),
  signOut: jest.fn(),
};
const mockAuthState: { value: typeof signedOutState | Record<string, unknown> } = { value: signedOutState };
const mockUseAuth = jest.fn(() => mockAuthState.value);

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'storeClient' },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));

jest.mock('expo-observe', () => {
  throw new Error('ExpoObserve native module is unavailable in Expo Go');
});

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

it('starts the app in Expo Go without loading the unavailable Observe module', () => {
  const RootLayout = require('@/app/_layout').default;
  const screen = render(<RootLayout />);
  expect(screen.toJSON()).not.toBeNull();
});
