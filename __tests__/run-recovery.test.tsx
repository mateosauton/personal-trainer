import { fireEvent, render, waitFor } from '@testing-library/react-native';
import Run from '@/app/session/[dayId]/run';

const mockPlan = jest.fn();
let mockSaved: any = null;
jest.mock('@/lib/session/workout', () => ({
  workouts: {
    withSnapshot: async (_owner: string, _snapshot: unknown, action: () => Promise<unknown>) => action(),
    read: async () => mockSaved,
    create: async (value: any) => {
      mockSaved = value;
      return value;
    },
    update: async (
      _owner: string,
      _session: string,
      _expected: any,
      patch: any,
    ) => {
      mockSaved = { ...mockSaved, ...patch };
      return mockSaved;
    },
  },
}));
const mockComplete = jest.fn();
const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace, back: jest.fn() };
const day = {
  id: 'day-1',
  blocks: [
    {
      id: 'block',
      kind: 'warmup',
      rounds: 1,
      items: [
        {
          id: 'item',
          exercise_id: 'unknown',
          sets: 1,
          reps_low: 6,
          reps_high: 8,
        },
      ],
    },
  ],
};
jest.mock('@/lib/auth', () => ({
  useUserId: () => 'user-1',
  useAuth: () => ({ profile: null }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ dayId: 'day-1', sessionId: 'session-1' }),
  useRouter: () => mockRouter,
}));
jest.mock('@/lib/db/queries', () => ({
  getSessionResumeDetails: async () => ({
    started_at: new Date(Date.now()).toISOString(),
    completed_at: null,
    duration_s: null,
  }),
  getSessionPlanDay: async () => (await mockPlan()).days[0],
  getProgress: async () => new Map(),
}));
jest.mock('@/lib/session/sync', () => ({
  bootstrapSetBaselines: async () => undefined,
  queueCompletion: (...args: unknown[]) => mockComplete(...args),
  flushOutbox: async () => undefined,
  pendingSyncCount: async () => 0,
  queueSet: async () => undefined,
}));
jest.mock('@/lib/alerts', () => ({
  notify: jest.fn(),
  confirm: async () => true,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSaved = null;
  mockPlan.mockResolvedValue({ days: [day] });
  mockComplete.mockResolvedValue(undefined);
});

it('shows and retries a failed workout load', async () => {
  mockPlan.mockRejectedValueOnce(new Error('Network unavailable'));
  const screen = render(<Run />);
  await waitFor(() =>
    expect(screen.getByText('Network unavailable')).toBeTruthy(),
  );
  fireEvent.press(screen.getByText('Retry'));
  await waitFor(() => expect(screen.getByText('Done')).toBeTruthy());
  expect(mockPlan).toHaveBeenCalledTimes(2);
});

it('retries a failed completion without discarding the finished workout', async () => {
  let now = 1000;
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  mockComplete.mockRejectedValueOnce(new Error('Storage unavailable'));
  const screen = render(<Run />);
  await waitFor(() => expect(screen.getByText('Done')).toBeTruthy());
  now = 11000;
  fireEvent.press(screen.getByText('Done'));
  await waitFor(() =>
    expect(screen.getByText('Storage unavailable')).toBeTruthy(),
  );
  expect(mockReplace).not.toHaveBeenCalled();
  now = 131000;
  fireEvent.press(screen.getByText('Retry finish'));
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/session/[dayId]/summary',
      }),
    ),
  );
  expect(mockComplete).toHaveBeenCalledTimes(2);
  expect(mockComplete.mock.calls.map((call) => call[2])).toEqual([10, 10]);
  expect(mockReplace.mock.calls[0][0].params.elapsed).toBe('10');
  clock.mockRestore();
});
