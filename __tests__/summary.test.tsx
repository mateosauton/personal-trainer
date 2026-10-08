jest.mock('@/lib/session/workout', () => ({
  workouts: {
    read: (...args: unknown[]) => mockWorkoutRead(...args),
    clear: jest.fn(async () => undefined),
  },
}));
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import Summary from '@/app/session/[dayId]/summary';

const mockWorkoutRead = jest.fn();
const mockApply = jest.fn(
  async (_session, _expected, _updates, lines, _versions?: unknown) => lines,
);
const mockReceipt = jest.fn();
const mockDay = jest.fn();
const mockFlush = jest.fn().mockResolvedValue(undefined);
const mockFailed = jest.fn().mockResolvedValue(0);
const mockPending = jest.fn().mockResolvedValue(0);
const mockLogs = jest.fn();
const mockProgress = jest.fn();
const mockReplace = jest.fn();
const mockProfile = { units: 'lb', bodyweight_kg: 80 };
const exerciseId = 'Barbell_Bench_Press_-_Medium_Grip';
const mockPlan = {
  days: [
    {
      id: 'day-1',
      blocks: [
        {
          kind: 'straight',
          items: [{ id: 'item-1', reps_low: 6, reps_high: 8 }],
        },
      ],
    },
  ],
};

jest.mock('@/lib/auth', () => ({
  useUserId: () => 'user-1',
  useAuth: () => ({ profile: mockProfile }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({
    dayId: 'day-1',
    sessionId: 'session-1',
    elapsed: '120',
  }),
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock('@/lib/db/queries', () => ({
  getSessionPlanDay: (...args: unknown[]) => mockDay(...args),
  getSessionProgressResult: () => mockReceipt(),
  applySessionProgress: (...args: Parameters<typeof mockApply>) =>
    mockApply(...args),
  getSetLogs: (...args: unknown[]) => mockLogs(...args),
  getSessionSetSnapshot: async (...args: unknown[]) => {
    const logs = await mockLogs(...args);
    return {
      logs,
      versions: logs.map((log: any, index: number) => ({
        logId: log.id ?? `log-${index}`,
        serverVersion: log.server_version ?? 1,
      })),
    };
  },
  getProgress: (...args: unknown[]) => mockProgress(...args),
}));
jest.mock('@/lib/session/sync', () => ({
  failedSyncCount: () => mockFailed(),
  flushOutbox: () => mockFlush(),
  pendingSyncCount: () => mockPending(),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockApply.mockReset();
  mockLogs.mockReset();
  mockProgress.mockReset();
  mockApply.mockImplementation(
    async (_session, _expected, _updates, lines) => lines,
  );
  mockWorkoutRead.mockResolvedValue(null);
  mockProfile.units = 'lb';
  mockProfile.bodyweight_kg = 80;
  mockReceipt.mockResolvedValue(null);
  mockDay.mockResolvedValue(mockPlan.days[0]);
  mockFlush.mockResolvedValue(undefined);
  mockFailed.mockResolvedValue(0);
  mockPending.mockResolvedValue(0);
  mockLogs.mockResolvedValue([
    {
      exercise_id: exerciseId,
      plan_item_id: 'item-1',
      set_index: 1,
      reps: 8,
      weight_kg: 60,
      is_bodyweight: false,
      added_load_kg: 0,
      rpe: null,
    },
  ]);
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
  await waitFor(() =>
    expect(
      screen.getByText(
        'Your workout is still syncing. Reconnect and retry to see all your sets.',
      ),
    ).toBeTruthy(),
  );
  expect(mockLogs).not.toHaveBeenCalled();
  expect(mockApply).not.toHaveBeenCalled();
  expect(screen.queryByText('Nice work.')).toBeNull();
  mockFailed.mockResolvedValue(0);
  mockPending.mockResolvedValue(0);
  await act(async () => {
    fireEvent.press(screen.getByText('Retry'));
  });
  await waitFor(() => expect(screen.getByText('Nice work.')).toBeTruthy());
  expect(mockApply).toHaveBeenCalledTimes(1);
});

it('shows a recoverable read error instead of a successful empty summary', async () => {
  mockLogs.mockRejectedValue(new Error('Network unavailable'));
  const screen = render(<Summary />);
  await waitFor(() =>
    expect(screen.getByText('Network unavailable')).toBeTruthy(),
  );
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
  const known = {
    exercise_id: exerciseId,
    last_weight_kg: 60,
    last_reps: 5,
    best_weight_kg: 60,
    best_e1rm: 70,
    miss_streak: 1,
  };
  mockLogs.mockResolvedValue([
    {
      exercise_id: exerciseId,
      plan_item_id: 'item-1',
      reps: 5,
      weight_kg: 60,
      is_bodyweight: false,
      added_load_kg: 0,
      rpe: null,
    },
  ]);
  mockProgress
    .mockResolvedValueOnce(new Map())
    .mockResolvedValue(new Map([[exerciseId, known]]));
  mockApply.mockRejectedValueOnce({
    code: '40001',
    message: 'Progression changed',
  });
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
  await waitFor(() =>
    expect(screen.getByText('Database unavailable')).toBeTruthy(),
  );
  expect(screen.queryByText('Nice work.')).toBeNull();
  fireEvent.press(screen.getByText('Retry'));
  await waitFor(() => expect(screen.getByText('Nice work.')).toBeTruthy());
});

it('does not apply progression or clear the snapshot when a set was rejected', async () => {
  mockFailed.mockResolvedValue(1);
  const screen = render(<Summary />);
  await waitFor(() =>
    expect(
      screen.getByText(
        'Some sets could not sync. Retry workout sync from Home before saving this summary.',
      ),
    ).toBeTruthy(),
  );
  expect(mockApply).not.toHaveBeenCalled();
  expect(
    require('@/lib/session/workout').workouts.clear,
  ).not.toHaveBeenCalled();
});

it('reloads corrected sets and passes their captured versions after a stale snapshot rejection', async () => {
  const initial = {
    id: 'log-1',
    exercise_id: exerciseId,
    plan_item_id: 'item-1',
    set_index: 1,
    reps: 8,
    weight_kg: 60,
    is_bodyweight: false,
    added_load_kg: 0,
    rpe: null,
    server_version: 1,
  };
  mockLogs
    .mockResolvedValueOnce([initial])
    .mockResolvedValue([
      { ...initial, reps: 5, weight_kg: 50, server_version: 2 },
    ]);
  mockApply.mockRejectedValueOnce({
    code: '40001',
    message: 'Workout sets changed',
  });
  const screen = render(<Summary />);
  await waitFor(() => expect(screen.getByText('Nice work.')).toBeTruthy());
  expect(mockLogs).toHaveBeenCalledTimes(2);
  expect(mockApply.mock.calls[0][4]).toEqual([
    { logId: 'log-1', serverVersion: 1 },
  ]);
  expect(mockApply.mock.calls[1][4]).toEqual([
    { logId: 'log-1', serverVersion: 2 },
  ]);
  expect(mockApply.mock.calls[0][3][0].volumeKg).toBe(480);
  expect(mockApply.mock.calls[1][3][0].volumeKg).toBe(250);
  expect(mockApply.mock.calls[1][2][0].last_weight_kg).toBe(50);
});
it('keeps the saved workout when snapshot changes exhaust automatic retries', async () => {
  mockApply.mockRejectedValue({
    code: '40001',
    message: 'Workout sets changed',
  });
  const screen = render(<Summary />);
  await waitFor(() =>
    expect(
      screen.getByText('Could not load your workout. Please retry.'),
    ).toBeTruthy(),
  );
  expect(mockApply).toHaveBeenCalledTimes(3);
  expect(mockLogs).toHaveBeenCalledTimes(3);
  expect(
    require('@/lib/session/workout').workouts.clear,
  ).not.toHaveBeenCalled();
});

it('uses the workout units after profile units change', async () => {
  mockWorkoutRead.mockResolvedValue({
    ownerId: 'user-1',
    sessionId: 'session-1',
    units: 'kg',
    bodyweightKg: 80,
  });
  const screen = render(<Summary />);
  await waitFor(() => expect(screen.getByText('Nice work.')).toBeTruthy());
  expect(mockApply.mock.calls[0][2][0].last_weight_kg).toBe(62.5);
  expect(screen.getByText('PR 60 kg')).toBeTruthy();
});
it('uses captured bodyweight after the profile changes', async () => {
  mockProfile.bodyweight_kg = 100;
  mockWorkoutRead.mockResolvedValue({
    ownerId: 'user-1',
    sessionId: 'session-1',
    units: 'lb',
    bodyweightKg: 80,
  });
  mockLogs.mockResolvedValue([
    {
      exercise_id: exerciseId,
      plan_item_id: 'item-1',
      set_index: 1,
      reps: 8,
      weight_kg: null,
      is_bodyweight: true,
      added_load_kg: 0,
      rpe: null,
    },
  ]);
  render(<Summary />);
  await waitFor(() => expect(mockApply).toHaveBeenCalled());
  expect(mockApply.mock.calls[0][3][0].volumeKg).toBe(640);
});
it('keeps unknown captured bodyweight unknown instead of retroactively using a new profile value', async () => {
  mockWorkoutRead.mockResolvedValue({
    ownerId: 'user-1',
    sessionId: 'session-1',
    units: 'lb',
    bodyweightKg: null,
  });
  mockLogs.mockResolvedValue([
    {
      exercise_id: exerciseId,
      plan_item_id: 'item-1',
      set_index: 1,
      reps: 8,
      weight_kg: null,
      is_bodyweight: true,
      added_load_kg: 0,
      rpe: null,
    },
  ]);
  render(<Summary />);
  await waitFor(() => expect(mockApply).toHaveBeenCalled());
  expect(mockApply.mock.calls[0][3][0].topLoadKg).toBeNull();
});


it('shows timed history without applying repetition progression', async () => {
  mockDay.mockResolvedValue({ ...mockPlan.days[0], blocks: [{ kind: 'straight', items: [{ id: 'item-1', reps_low: 6, reps_high: 8, seconds: 40 }] }] });
  mockLogs.mockResolvedValue([{ exercise_id: exerciseId, plan_item_id: 'item-1', set_index: 1,
    reps: null, seconds: 40, weight_kg: 60, is_bodyweight: false, added_load_kg: 0, rpe: null }]);
  const screen = render(<Summary />);
  await waitFor(() => expect(mockApply).toHaveBeenCalled());
  expect(mockApply.mock.calls[0][2]).toEqual([]);
  expect(mockApply.mock.calls[0][3][0]).toMatchObject({ seconds: 40, volumeKg: 0, isPr: false, verdict: null });
  expect(screen.getByText('1 sets · 40s timed')).toBeTruthy();
});
