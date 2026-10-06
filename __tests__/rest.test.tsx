import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import * as Haptics from 'expo-haptics';
import { RestPage } from '@/components/RestPage';

jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(), selectionAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
const props = {
  exercise: null, setLabel: 'Set 1', targetReps: '8', units: 'kg' as const,
  bodyweightKg: 80, restSeconds: 90,
  draft: { reps: 8, weight: 60, asBodyweight: false }, onChange: jest.fn(),
  next: null, onAdvance: jest.fn(),
};

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-05T12:00:00Z')); jest.clearAllMocks(); });
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

it('counts elapsed wall time after interval callbacks are suspended', () => {
  const screen = render(<RestPage {...props} />);
  expect(screen.getByText('1:30')).toBeTruthy();
  act(() => { jest.setSystemTime(Date.now() + 60000); jest.advanceTimersByTime(1000); });
  expect(screen.getByText('0:29')).toBeTruthy();
});

it('refreshes immediately on foreground and buzzes once at the deadline', () => {
  let onState: (state: AppStateStatus) => void = () => {};
  const remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    onState = callback; return { remove };
  });
  const screen = render(<RestPage {...props} />);
  act(() => { jest.setSystemTime(Date.now() + 95000); onState('active'); });
  expect(screen.getByText('0:00')).toBeTruthy();
  expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  act(() => { jest.advanceTimersByTime(3000); onState('active'); });
  expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  screen.unmount();
  expect(remove).toHaveBeenCalled();
});
