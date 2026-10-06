import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import Summary from '@/app/session/[dayId]/summary';

const mockQueueProgress = jest.fn().mockResolvedValue(undefined);
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
  getActivePlan: async () => mockPlan,
  getSetLogs: (...args: unknown[]) => mockLogs(...args),
  getProgress: (...args: unknown[]) => mockProgress(...args),
}));
jest.mock('@/lib/session/sync', () => ({
  queueProgress: (...args: unknown[]) => mockQueueProgress(...args),
  flushOutbox: () => mockFlush(), pendingSyncCount: () => mockPending(),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockFlush.mockResolvedValue(undefined);
  mockPending.mockResolvedValue(0);
  mockLogs.mockResolvedValue([{ exercise_id: exerciseId, plan_item_id: 'item-1', set_index: 1,
    reps: 8, weight_kg: 60, is_bodyweight: false, added_load_kg: 0, rpe: null }]);
  mockProgress.mockResolvedValue(new Map());
});

it('uses pound increments when updating an lb lifter', async () => {
  render(<Summary />);
  await waitFor(() => expect(mockQueueProgress).toHaveBeenCalled());
  const update = mockQueueProgress.mock.calls[0][1][0];
  expect(update.last_weight_kg).toBeCloseTo(60 + 5 / 2.2046226218, 6);
});

it('blocks summary and progression while workout writes are pending, then retries', async () => {
  mockPending.mockResolvedValue(1);
  const screen = render(<Summary />);
  await waitFor(() => expect(screen.getByText('Your workout is still syncing. Reconnect and retry to see all your sets.')).toBeTruthy());
  expect(mockLogs).not.toHaveBeenCalled();
  expect(mockQueueProgress).not.toHaveBeenCalled();
  expect(screen.queryByText('Nice work.')).toBeNull();
  mockPending.mockResolvedValue(0);
  await act(async () => { fireEvent.press(screen.getByText('Retry')); });
  await waitFor(() => expect(screen.getByText('Nice work.')).toBeTruthy());
  expect(mockQueueProgress).toHaveBeenCalledTimes(1);
});

it('shows a recoverable read error instead of a successful empty summary', async () => {
  mockLogs.mockRejectedValue(new Error('Network unavailable'));
  const screen = render(<Summary />);
  await waitFor(() => expect(screen.getByText('Network unavailable')).toBeTruthy());
  expect(screen.queryByText('Nice work.')).toBeNull();
  expect(mockQueueProgress).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Back to home'));
  expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
});
