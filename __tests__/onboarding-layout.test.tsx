import { fireEvent, render, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';

import Onboarding from '@/app/onboarding';

jest.mock('@/components/Icon', () => ({ Icon: () => null }));
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  const chain = () => {
    const animation: Record<string, () => unknown> = {};
    for (const name of ['duration', 'springify', 'damping', 'reduceMotion', 'delay']) {
      animation[name] = () => animation;
    }
    return animation;
  };
  return {
    __esModule: true,
    default: { View: (props: object) => React.createElement(View, props) },
    FadeIn: chain(),
    SlideInLeft: chain(),
    SlideInRight: chain(),
    SlideOutLeft: chain(),
    SlideOutRight: chain(),
    ReduceMotion: { System: 'system' },
    useReducedMotion: () => true,
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: (factory: () => object) => factory(),
    withSpring: (value: unknown) => value,
    withTiming: (value: unknown) => value,
    withSequence: (...values: unknown[]) => values[0],
  };
});

const mockSavePlan = jest.fn();
const mockUpdateProfile = jest.fn();
const mockRefreshProfile = jest.fn();
const mockGenerate = jest.fn(() => ({ name: 'plan' }));

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(),
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: false })),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({
  useUserId: () => 'user-1',
  useAuth: () => ({ refreshProfile: mockRefreshProfile }),
}));
jest.mock('@/lib/db/queries', () => ({
  savePlan: (...args: unknown[]) => mockSavePlan(...args),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
  uploadAvatar: jest.fn(),
}));
jest.mock('@/lib/plan/office-gym', () => ({
  generateOfficeGymPlan: () => mockGenerate(),
}));

const metrics = {
  insets: { top: 20, right: 0, bottom: 0, left: 0 },
  frame: { x: 0, y: 0, width: 320, height: 568 },
};

function renderOnboarding() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <Onboarding />
    </SafeAreaProvider>,
  );
}

function layout(height: number, width = 320) {
  return { nativeEvent: { layout: { height, width, x: 0, y: 0 } } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSavePlan.mockResolvedValue('plan-1');
  mockUpdateProfile.mockResolvedValue(undefined);
  mockRefreshProfile.mockResolvedValue(undefined);
});

describe('compact onboarding', () => {
  it('scrolls the goal choices without putting Continue inside the question', () => {
    const screen = renderOnboarding();
    fireEvent.press(screen.getByText('Continue'));

    const question = screen.getByTestId('onboarding-question-scroll');
    const actions = screen.getByTestId('onboarding-actions');
    expect(within(question).getByRole('radio', { name: 'Get stronger' })).toBeTruthy();
    expect(within(question).getByRole('radio', { name: 'Build muscle' })).toBeTruthy();
    expect(within(question).getByRole('radio', { name: 'Lean out' })).toBeTruthy();
    expect(within(question).getByRole('radio', { name: 'Stay fit' })).toBeTruthy();
    expect(within(question).queryByText('Continue')).toBeNull();
    expect(within(question).queryByText('Back')).toBeNull();
    expect(within(actions).getByText('Continue')).toBeTruthy();
    expect(within(actions).getByText('Back')).toBeTruthy();
    expect(StyleSheet.flatten(question.props.style)).toMatchObject({ flex: 1, overflow: 'hidden' });
  });

  it('wraps day and session-length choices instead of keeping them on one row', () => {
    const screen = renderOnboarding();
    fireEvent.press(screen.getByText('Continue'));
    fireEvent.press(screen.getByText('Continue'));
    fireEvent.press(screen.getByText('Continue'));

    const days = screen.getByTestId('onboarding-days');
    expect(StyleSheet.flatten(days.props.style)).toMatchObject({ flexWrap: 'wrap' });
    for (const day of ['2', '3', '4', '5', '6']) expect(within(days).getByText(day)).toBeTruthy();

    fireEvent.press(screen.getByText('Continue'));
    const length = screen.getByTestId('onboarding-length');
    expect(StyleSheet.flatten(length.props.style)).toMatchObject({ flexWrap: 'wrap' });
    expect(within(length).getByText('30 min')).toBeTruthy();
    expect(within(length).getByText('60 min')).toBeTruthy();
  });

  it('scrolls the whole shell when the footer would cover a short viewport', () => {
    const screen = renderOnboarding();
    fireEvent.press(screen.getByText('Continue'));
    fireEvent(screen.getByTestId('onboarding-shell'), 'layout', layout(200));
    fireEvent(screen.getByTestId('onboarding-header'), 'layout', layout(80));
    fireEvent(screen.getByTestId('onboarding-footer'), 'layout', layout(80));

    const shell = screen.getByTestId('onboarding-shell-scroll');
    expect(screen.queryByTestId('onboarding-question-scroll')).toBeNull();
    expect(within(shell).getByRole('radio', { name: 'Stay fit' })).toBeTruthy();
    expect(within(shell).getByText('Continue')).toBeTruthy();
    expect(within(shell).getByText('Back')).toBeTruthy();
  });

  it('keeps the selected goal when going back', () => {
    const screen = renderOnboarding();
    fireEvent.press(screen.getByText('Continue'));
    fireEvent.press(screen.getByRole('radio', { name: 'Get stronger' }));
    fireEvent.press(screen.getByText('Continue'));
    fireEvent.press(screen.getByText('Back'));
    expect(screen.getByRole('radio', { name: 'Get stronger' }).props.accessibilityState).toEqual({ selected: true });
  });

  it('converts measurements before finishing and ignores a repeated submit', async () => {
    const screen = renderOnboarding();
    for (let step = 0; step < 6; step += 1) fireEvent.press(screen.getByText('Continue'));
    fireEvent.changeText(screen.getByLabelText('Bodyweight'), '78');
    fireEvent.changeText(screen.getByLabelText('Height'), '180');
    fireEvent.press(screen.getByText('LB'));
    expect(screen.getByLabelText('Bodyweight').props.value).toBe('172');
    expect(screen.getByLabelText('Height').props.value).toBe('70.9');

    let release: (value: string) => void = () => undefined;
    mockSavePlan.mockReturnValue(new Promise<string>((resolve) => { release = resolve; }));
    fireEvent.press(screen.getByText('Continue'));
    const build = screen.getByText('Build my plan');
    fireEvent.press(build);
    fireEvent.press(build);
    expect(mockSavePlan).toHaveBeenCalledTimes(1);
    release('plan-1');
    await screen.findByText('Hang tight');
    expect(mockUpdateProfile).toHaveBeenCalledWith('user-1', expect.objectContaining({
      units: 'lb',
      bodyweight_kg: 78,
      height_cm: 180,
    }));
  });
});
