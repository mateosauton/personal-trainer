jest.mock('@/lib/session/workout', () => ({ workouts: { clear: jest.fn(async () => undefined) } }));
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import Summary from '@/app/session/[dayId]/summary';

const mockApply = jest.fn(async (_session, _expected, _updates, lines) => lines);
const mockReceipt = jest.fn();
const mockDay = jest.fn();
const mockFlush = jest.fn().mockResolvedValue(undefined);
const mockPending = jest.fn().mockResolvedValue(0);
const mockLogs = jest.fn();
const mockProgress = jest.fn();
const mockReplace = jest.fn();
const mockProfile = { units: 'lb', bodyweight_kg: 80 };
const exerciseId = 'Barbell_Bench_Press_-_Medium_Grip';
const mockPlan = { days: [{ id: 'day-1', blocks: [{ kind: 'straight', items: [
  { id: 'item-1', reps_low: 6, reps_high: 8 },
] }] }] };

jest.mock('@/lib/auth', () => ({ useUserId: () => 'user-1', useAuth: () => ({ profile: mockProfile }) }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ dayId: 'day-1', sessionId: 'session-1', elapsed: '120' }),
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock('@/lib/db/queries', () => ({
  getSessionPlanDay: (...args: unknown[]) => mockDay(...args),
  getSessionProgressResult: () => mockReceipt(),
  applySessionProgress: (...args: Parameters<typeof mockApply>) => mockApply(...args),
  getSetLogs: (...args: unknown[]) => mockLogs(...args),
  getProgress: (...args: unknown[]) => mockProgress(...args),
}));
jest.mock('@/lib/session/sync', () => ({
  flushOutbox: () => mockFlush(), pendingSyncCount: () => mockPending(),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockApply.mockImplementation(async (_session, _expected, _updates, lines) => lines);
  mockReceipt.mockResolvedValue(null);
  mockDay.mockResolvedValue(mockPlan.days[0]);
  mockFlush.mockResolvedValue(undefined);
  mockPending.mockResolvedValue(0);
  mockLogs.mockResolvedValue([{ exercise_id: exerciseId, plan_item_id: 'item-1', set_index: 1,
    reps: 8, weight_kg: 60, is_bodyweight: false, added_load_kg: 0, rpe: null }]);
  mockProgress.mockResolvedValue(new Map());
});

it('uses pound increments when updating an lb lifter', async () => {
  render(<Summary />);
  await waitFor(() => expect(mockApply).toHaveBeenCalled());
  const update = mockApply.mock.calls[0][2][0];
  expect(update.last_weight_kg).toBeCloseTo(60 + 5 / 2.2046226218, 6);
});

it('blocks summary and progression while workout writes are pending, then retries', async () => {
  mockPending.mockResolvedValue(1);
  const screen = render(<Summary />);
  await waitFor(() => expect(screen.getByText('Your workout is still syncing. Reconnect and retry to see all your sets.')).toBeTruthy());
  expect(mockLogs).not.toHaveBeenCalled();
  expect(mockApply).not.toHaveBeenCalled();
  expect(screen.queryByText('Nice work.')).toBeNull();
  mockPending.mockResolvedValue(0);
  await act(async () => { fireEvent.press(screen.getByText('Retry')); });
  await waitFor(() => expect(screen.getByText('Nice work.')).toBeTruthy());
  expect(mockApply).toHaveBeenCalledTimes(1);
});

it('shows a recoverable read error instead of a successful empty summary', async () => {
  mockLogs.mockRejectedValue(new Error('Network unavailable'));
  const screen = render(<Summary />);
  await waitFor(() => expect(screen.getByText('Network unavailable')).toBeTruthy());
  expect(screen.queryByText('Nice work.')).toBeNull();
  expect(mockApply).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Back to home'));
  expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
});


it('reopening the summary reads its original receipt without applying again', async () => {
  const first = render(<Summary />);
  await waitFor(() => expect(first.getByText('Nice work.')).toBeTruthy());
  const receipt = mockApply.mock.calls[0][3];
  expect(receipt[0].isPr).toBe(true);
  first.unmount();
  mockReceipt.mockResolvedValue(receipt);
  const reopened = render(<Summary />);
  await waitFor(() => expect(reopened.getByText('Nice work.')).toBeTruthy());
  expect(mockApply).toHaveBeenCalledTimes(1);
  expect(mockLogs).toHaveBeenCalledTimes(1);
  expect(reopened.getByText('PR 132.3 lb')).toBeTruthy();
});

it('reloads the baseline when another workout changed progression', async () => {
  const known = { exercise_id: exerciseId, last_weight_kg: 60, last_reps: 5,
    best_weight_kg: 60, best_e1rm: 70, miss_streak: 1 };
  mockLogs.mockResolvedValue([{ exercise_id: exerciseId, plan_item_id: 'item-1',
    reps: 5, weight_kg: 60, is_bodyweight: false, added_load_kg: 0, rpe: null }]);
  mockProgress.mockResolvedValueOnce(new Map()).mockResolvedValue(new Map([[exerciseId, known]]));
  mockApply.mockRejectedValueOnce({ code: '40001', message: 'Progression changed' });
  const screen = render(<Summary />);
  await waitFor(() => expect(screen.getByText('Nice work.')).toBeTruthy());
  expect(mockApply).toHaveBeenCalledTimes(2);
  expect(mockApply.mock.calls[0][2][0].miss_streak).toBe(1);
  expect(mockApply.mock.calls[1][1][0].state).toEqual(known);
  expect(mockApply.mock.calls[1][2][0].miss_streak).toBe(0);
  expect(mockApply.mock.calls[1][3][0].verdict).toBe('deload');
  expect(mockDay).toHaveBeenCalledWith('session-1', 'user-1');
});

it('keeps failed transactional progression recoverable', async () => {
  mockApply.mockRejectedValueOnce(new Error('Database unavailable'));
  const screen = render(<Summary />);
  await waitFor(() => expect(screen.getByText('Database unavailable')).toBeTruthy());
  expect(screen.queryByText('Nice work.')).toBeNull();
  fireEvent.press(screen.getByText('Retry'));
  await waitFor(() => expect(screen.getByText('Nice work.')).toBeTruthy());
});
