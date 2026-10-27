import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import Profile from '@/app/profile';
import type { Profile as AccountProfile } from '@/lib/types';

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
    ReduceMotion: { System: 'system' },
    useReducedMotion: () => true,
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: (factory: () => object) => factory(),
    withSpring: (value: unknown) => value,
    withTiming: (value: unknown) => value,
    withSequence: (...values: unknown[]) => values[0],
  };
});

const mockUpdateProfile = jest.fn();
const mockRefreshProfile = jest.fn();
const mockBack = jest.fn();

const profile = {
  id: 'user-1',
  display_name: 'Ada',
  avatar_url: null,
  units: 'kg',
  bodyweight_kg: 78,
  height_cm: 180,
  goal: 'hypertrophy',
  experience: 'intermediate',
  days_per_week: 4,
  session_minutes: 45,
  equipment: [],
  limitations: [],
  onboarded_at: '2026-10-01T00:00:00.000Z',
} as AccountProfile;

jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(),
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack, replace: jest.fn() }) }));
jest.mock('@/lib/useAvatar', () => ({ useAvatar: () => null }));
jest.mock('@/lib/alerts', () => ({ notify: jest.fn(), confirm: jest.fn() }));
jest.mock('@/components/TrainingPreferences', () => ({ TrainingPreferences: () => null }));
jest.mock('@/components/AccountPrivacy', () => ({ AccountPrivacy: () => null }));
jest.mock('@/components/Attribution', () => ({ Attribution: () => null }));
jest.mock('@/lib/auth', () => ({
  useUserId: () => 'user-1',
  useAuth: () => ({ profile, refreshProfile: mockRefreshProfile, signOut: jest.fn() }),
}));
jest.mock('@/lib/db/queries', () => ({
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
  uploadAvatar: jest.fn(),
}));

function renderProfile() {
  return render(
    <SafeAreaProvider initialMetrics={{
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      frame: { x: 0, y: 0, width: 320, height: 568 },
    }}>
      <Profile />
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateProfile.mockResolvedValue(undefined);
  mockRefreshProfile.mockResolvedValue(undefined);
});

describe('profile measurement drafts', () => {
  it('converts an unsaved edit and saves units with it', async () => {
    const screen = renderProfile();
    expect(screen.getByLabelText('Bodyweight').props.value).toBe('78');
    expect(screen.getByLabelText('Height').props.value).toBe('180');
    fireEvent.changeText(screen.getByLabelText('Bodyweight'), '90');
    fireEvent.press(screen.getByText('LB'));
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Bodyweight').props.value).toBe('198.4');
    expect(screen.getByLabelText('Height').props.value).toBe('70.9');

    fireEvent.press(screen.getByText('KG'));
    fireEvent.press(screen.getByText('LB'));
    expect(screen.getByLabelText('Bodyweight').props.value).toBe('198.4');
    fireEvent.changeText(screen.getByPlaceholderText('Your name'), 'Ada Lovelace');
    fireEvent.press(screen.getByText('Save'));

    await screen.findByText('Saved');
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfile).toHaveBeenCalledWith('user-1', expect.objectContaining({
      display_name: 'Ada Lovelace',
      units: 'lb',
      bodyweight_kg: 90,
      height_cm: 180,
    }));
  });

  it('does not persist a unit switch when the profile is closed', () => {
    const screen = renderProfile();
    fireEvent.changeText(screen.getByLabelText('Bodyweight'), '90');
    fireEvent.press(screen.getByText('LB'));
    fireEvent.press(screen.getByLabelText('Close profile'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(mockRefreshProfile).not.toHaveBeenCalled();
  });

  it('keeps empty and partial drafts from changing stored measurements', async () => {
    const screen = renderProfile();
    fireEvent.changeText(screen.getByLabelText('Bodyweight'), '');
    fireEvent.press(screen.getByText('LB'));
    expect(screen.getByLabelText('Bodyweight').props.value).toBe('');
    fireEvent.changeText(screen.getByLabelText('Height'), '180.');
    fireEvent.press(screen.getByText('KG'));
    expect(screen.getByText(/clear it before switching units/i)).toBeTruthy();
    expect(screen.getByLabelText('Height').props.value).toBe('180.');
    fireEvent.press(screen.getByText('Save'));
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(screen.getByText(/enter a height or leave it blank/i)).toBeTruthy();
  });

  it('keeps the edit after a failed save, exposes Retry, and ignores a second tap', async () => {
    const screen = renderProfile();
    fireEvent.changeText(screen.getByLabelText('Bodyweight'), '90');
    fireEvent.press(screen.getByText('LB'));

    let release: () => void = () => undefined;
    mockUpdateProfile.mockReturnValueOnce(new Promise<void>((_resolve, reject) => {
      release = () => reject(new Error('offline'));
    }));
    const save = screen.getByText('Save');
    fireEvent.press(save);
    fireEvent.press(save);
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    release();

    await screen.findByText('Retry');
    expect(screen.getByText('offline')).toBeTruthy();
    expect(screen.getByLabelText('Bodyweight').props.value).toBe('198.4');

    mockUpdateProfile.mockResolvedValueOnce(undefined);
    fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
    expect(mockUpdateProfile).toHaveBeenCalledTimes(2);
    expect(mockUpdateProfile.mock.calls[1][1]).toEqual(expect.objectContaining({
      units: 'lb',
      bodyweight_kg: 90,
    }));
  });
});
