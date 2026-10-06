import { fireEvent, render, waitFor } from '@testing-library/react-native';
import Run from '@/app/session/[dayId]/run';
import type { SavedWorkout } from '@/lib/session/workout-store';

const mockDetails = jest.fn();
const mockRead = jest.fn(),
  mockUpdate = jest.fn(),
  mockDay = jest.fn(),
  mockProgress = jest.fn();
const mockComplete = jest.fn(),
  mockSet = jest.fn(),
  mockReplace = jest.fn();
const mockRouter = { replace: mockReplace, back: jest.fn() };
let saved: SavedWorkout;
jest.mock('@/lib/session/workout', () => ({
  workouts: {
    read: (...args: unknown[]) => mockRead(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    create: jest.fn(),
    clear: jest.fn(),
  },
}));
jest.mock('@/lib/auth', () => ({
  useUserId: () => 'A',
  useAuth: () => ({ profile: { units: 'lb' } }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ dayId: 'day', sessionId: 'session-A' }),
  useRouter: () => mockRouter,
}));
jest.mock('@/lib/db/queries', () => ({
  getSessionResumeDetails: (...args: unknown[]) => mockDetails(...args),
  getSessionPlanDay: (...args: unknown[]) => mockDay(...args),
  getActivePlan: () => mockDay(),
  getProgress: () => mockProgress(),
}));
jest.mock('@/lib/session/sync', () => ({
  queueCompletion: (...args: unknown[]) => mockComplete(...args),
  queueSet: (...args: unknown[]) => mockSet(...args),
  flushOutbox: async () => undefined,
  pendingSyncCount: async () => 0,
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
  saved = {
    version: 1,
    ownerId: 'A',
    sessionId: 'session-A',
    units: 'kg',
    cursor: 0,
    phase: 'resting',
    draft: { reps: 7, weight: 60, asBodyweight: false },
    savedDraft: { reps: 8, weight: 60, asBodyweight: false },
    restUntilMs: Date.now() - 1000,
    startedAtMs: 1000,
    endedAtMs: null,
    progress: [],
    day: {
      id: 'day',
      day_index: 0,
      name: 'Day',
      focus: 'Strength',
      blocks: [
        {
          id: 'block',
          block_index: 0,
          kind: 'straight',
          title: 'Work',
          rounds: 1,
          rest_seconds: 90,
          items: [
            {
              id: 'item',
              item_index: 0,
              exercise_id: 'unknown',
              sets: 2,
              reps_low: 6,
              reps_high: 8,
              seconds: null,
              tempo: null,
              notes: null,
            },
          ],
        },
      ],
    },
  };
  mockRead.mockImplementation(async () => saved);
  mockUpdate.mockImplementation(async (_owner, _session, _expected, patch) => {
    saved = { ...saved, ...patch };
    return saved;
  });
  mockDay.mockRejectedValue(new Error('offline'));
  mockProgress.mockRejectedValue(new Error('offline'));
  mockComplete.mockResolvedValue(undefined);
  mockSet.mockResolvedValue(undefined);
});

it('restores offline rest and its draft/deadline without a server read', async () => {
  const screen = render(<Run />);
  await waitFor(() => expect(screen.getByText('0:00')).toBeTruthy());
  expect(screen.getByText('7')).toBeTruthy();
  expect(screen.getByText('60 kg')).toBeTruthy();
  expect(mockDay).not.toHaveBeenCalled();
  expect(mockProgress).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Next set'));
  await waitFor(() => expect(mockSet).toHaveBeenCalled());
  expect(mockSet.mock.calls[0][2].weight_kg).toBe(60); // Saved kg draft must not become lb after profile changes.
  await waitFor(() => expect(screen.getByText('Complete set')).toBeTruthy());
  expect(saved.cursor).toBe(1);
});

it('resumes a finished workout with its frozen duration', async () => {
  saved = {
    ...saved,
    cursor: 2,
    phase: 'work',
    draft: null,
    savedDraft: null,
    restUntilMs: null,
    endedAtMs: 11000,
  };
  render(<Run />);
  await waitFor(() =>
    expect(mockComplete).toHaveBeenCalledWith('A', 'session-A', 10),
  );
  await waitFor(() => expect(mockReplace).toHaveBeenCalled());
  expect(mockReplace.mock.calls[0][0].params.elapsed).toBe('10');
});

it('keeps the current set visible when snapshot persistence fails', async () => {
  mockUpdate.mockRejectedValueOnce(new Error('disk full'));
  const screen = render(<Run />);
  await waitFor(() => expect(screen.getByText('Next set')).toBeTruthy());
  fireEvent.press(screen.getByText('Next set'));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  expect(screen.getByText('Next set')).toBeTruthy();
  expect(mockReplace).not.toHaveBeenCalled();
});

it('opens the saved summary instead of logging again through a completed-session URL', async () => {
  mockRead.mockResolvedValue(null);
  mockDetails.mockResolvedValue({
    started_at: new Date(1000).toISOString(),
    completed_at: new Date(51000).toISOString(),
    duration_s: 50,
  });
  render(<Run />);
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/session/[dayId]/summary',
      params: { dayId: 'day', sessionId: 'session-A', elapsed: '50' },
    }),
  );
  expect(mockSet).not.toHaveBeenCalled();
  expect(mockDay).not.toHaveBeenCalled();
});
