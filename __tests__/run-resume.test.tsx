import { fireEvent, render, waitFor } from '@testing-library/react-native';
import Run from '@/app/session/[dayId]/run';
import type { SavedWorkout } from '@/lib/session/workout-store';

const mockDetails = jest.fn();
const mockBootstrap = jest.fn();
const mockStageLegacy = jest.fn();
const mockRead = jest.fn(),
  mockUpdate = jest.fn(),
  mockDay = jest.fn(),
  mockProgress = jest.fn();
const mockComplete = jest.fn(),
  mockSet = jest.fn(),
  mockReplace = jest.fn();
const mockRouter = { replace: mockReplace, back: jest.fn() };
let saved: SavedWorkout;
let mockSessionId = 'session-A';
jest.mock('@/lib/session/workout', () => ({
  workouts: {
    withSnapshot: async (_owner: string, _snapshot: unknown, action: () => Promise<unknown>) => action(),
    read: (...args: unknown[]) => mockRead(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    create: jest.fn(),
    clear: jest.fn(),
  },
}));
jest.mock('@/lib/auth', () => ({
  useUserId: () => 'A',
  useAuth: () => ({ profile: { units: 'lb', bodyweight_kg: 100 } }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ dayId: 'day', sessionId: mockSessionId }),
  useRouter: () => mockRouter,
}));
jest.mock('@/lib/db/queries', () => ({
  getSessionResumeDetails: (...args: unknown[]) => mockDetails(...args),
  getSessionPlanDay: (...args: unknown[]) => mockDay(...args),
  getActivePlan: () => mockDay(),
  getProgress: () => mockProgress(),
}));
jest.mock('@/lib/session/sync', () => ({
  bootstrapSetBaselines: (...args: unknown[]) => mockBootstrap(...args),
  stageLegacyRestRecovery: (...args: unknown[]) => mockStageLegacy(...args),
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
  mockSessionId = 'session-A';
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
  mockBootstrap.mockReset().mockResolvedValue(undefined);
  mockStageLegacy.mockReset().mockResolvedValue({});
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
it('shows captured bodyweight on the restored rest screen', async () => {
  saved = {
    ...saved,
    bodyweightKg: 80,
    draft: { reps: 7, weight: 0, asBodyweight: true },
    savedDraft: { reps: 8, weight: 0, asBodyweight: true },
  };
  const screen = render(<Run />);
  await waitFor(() =>
    expect(
      screen.getByText('Effective load 80 kg (bodyweight + added)'),
    ).toBeTruthy(),
  );
});
it('preserves unknown captured bodyweight on the restored rest screen', async () => {
  saved = {
    ...saved,
    bodyweightKg: null,
    draft: { reps: 7, weight: 0, asBodyweight: true },
    savedDraft: { reps: 8, weight: 0, asBodyweight: true },
  };
  const screen = render(<Run />);
  await waitFor(() =>
    expect(
      screen.getByText(
        'No bodyweight saved for this workout. Add it in Profile for future workouts.',
      ),
    ).toBeTruthy(),
  );
  expect(
    screen.queryByText('Effective load 100 kg (bodyweight + added)'),
  ).toBeNull();
});

it('captures the observed saved rest value in its original units before showing correction controls', async () => {
  const screen = render(<Run />);
  await waitFor(() => expect(mockBootstrap).toHaveBeenCalledWith('A', 'session-A', [expect.objectContaining({
    plan_item_id: 'item', exercise_id: 'unknown', set_index: 1, reps: 8, weight_kg: 60,
  })], saved));
  expect(screen.getByText('Next set')).toBeTruthy();
});
it('preserves a reopened rest draft when its initial baseline cannot be read', async () => {
  mockBootstrap.mockRejectedValue(new Error('Could not read saved set version.'));
  const before = JSON.stringify(saved);
  const screen = render(<Run />);
  await waitFor(() => expect(screen.getByText('Could not read saved set version.')).toBeTruthy());
  expect(JSON.stringify(saved)).toBe(before);
  expect(mockSet).not.toHaveBeenCalled();
});
it('shows an older rest offline and retains its correction until a baseline read succeeds', async () => {
  mockBootstrap.mockRejectedValue(new Error('Network request failed'));
  const screen = render(<Run />);
  await waitFor(() => expect(screen.getByText('Next set')).toBeTruthy());
  expect(screen.getByText('7')).toBeTruthy();
  fireEvent.press(screen.getByText('Next set'));
  await waitFor(() => expect(mockBootstrap).toHaveBeenCalledTimes(2));
  expect(mockSet).not.toHaveBeenCalled();
  expect(saved.cursor).toBe(0); expect(saved.draft?.reps).toBe(7);
});
it('continues logging new sets offline after advancing an unchanged older rest', async () => {
  saved = { ...saved, draft: saved.savedDraft };
  mockBootstrap.mockRejectedValue(new Error('Network request failed'));
  const screen = render(<Run />);
  await waitFor(() => expect(screen.getByText('Next set')).toBeTruthy());
  fireEvent.press(screen.getByText('Next set'));
  await waitFor(() => expect(screen.getByText('Complete set')).toBeTruthy());
  fireEvent.press(screen.getByText('Complete set'));
  await waitFor(() => expect(mockSet).toHaveBeenCalledWith('A', 'session-A', expect.objectContaining({ set_index: 2 })));
  expect(mockBootstrap).toHaveBeenCalledTimes(1);
});

it('ignores an older load failure after switching to another workout', async () => {
  let rejectOld!: (error: Error) => void;
  mockBootstrap.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }));
  const screen = render(<Run />);
  await waitFor(() => expect(mockBootstrap).toHaveBeenCalledTimes(1));
  mockSessionId = 'session-B';
  saved = { ...saved, sessionId: 'session-B', draft: { reps: 11, weight: 60, asBodyweight: false },
    savedDraft: { reps: 12, weight: 60, asBodyweight: false } };
  screen.rerender(<Run />);
  await waitFor(() => expect(screen.getByText('11')).toBeTruthy());
  rejectOld(new Error('Network request failed'));
  await waitFor(() => expect(mockBootstrap).toHaveBeenCalledTimes(2));
  fireEvent.press(screen.getByText('Next set'));
  await waitFor(() => expect(mockSet).toHaveBeenCalledWith('A', 'session-B', expect.objectContaining({ reps: 11 })));
  expect(mockBootstrap).toHaveBeenCalledTimes(2);
});

it('preserves an unknown-time older rest without publishing a guessed completion time', async () => {
  mockBootstrap.mockRejectedValue(Object.assign(new Error('Explicit recovery required.'), { code: 'PT409' }));
  const screen = render(<Run />);
  await waitFor(() => expect(screen.getByText('Next set')).toBeTruthy());
  fireEvent.press(screen.getByText('Next set'));
  await waitFor(() => expect(mockBootstrap).toHaveBeenCalledTimes(2));
  expect(mockSet).not.toHaveBeenCalled(); expect(saved.cursor).toBe(0);
});

it('opens explicit recovery for an older rest while preserving its visible correction', async () => {
  mockBootstrap.mockRejectedValue(Object.assign(new Error('Explicit recovery required.'), { code: 'PT409' }));
  const screen = render(<Run />);
  await waitFor(() => expect(screen.getByText('Review saved set')).toBeTruthy());
  fireEvent.press(screen.getByText('Review saved set'));
  await waitFor(() => expect(mockStageLegacy).toHaveBeenCalledWith('A', expect.objectContaining({
    draft: { reps: 7, weight: 60, asBodyweight: false }, savedDraft: { reps: 8, weight: 60, asBodyweight: false },
  })));
  expect(mockSet).not.toHaveBeenCalled(); expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
});
it('keeps the rest screen and draft when recovery staging cannot be saved', async () => {
  mockBootstrap.mockRejectedValue(new Error('Network request failed'));
  mockStageLegacy.mockRejectedValue(new Error('disk full'));
  const screen = render(<Run />);
  await waitFor(() => expect(screen.getByText('Review saved set')).toBeTruthy());
  fireEvent.press(screen.getByText('Review saved set'));
  await waitFor(() => expect(mockStageLegacy).toHaveBeenCalled());
  expect(mockReplace).not.toHaveBeenCalled(); expect(saved.draft?.reps).toBe(7);
});
it('does not advance an unchanged older set that is known to require explicit recovery', async () => {
  saved = { ...saved, draft: saved.savedDraft };
  mockBootstrap.mockRejectedValue(Object.assign(new Error('Explicit recovery required.'), { code: 'PT409' }));
  const screen = render(<Run />); await screen.findByText('Next set');
  fireEvent.press(screen.getByText('Next set'));
  await waitFor(() => expect(mockBootstrap).toHaveBeenCalledTimes(2));
  expect(saved.cursor).toBe(0); expect(mockSet).not.toHaveBeenCalled();
});
it('durably stages an unchanged unknown older rest before advancing offline', async () => {
  saved = { ...saved, draft: saved.savedDraft };
  mockBootstrap.mockRejectedValue(new Error('Network request failed'));
  const screen = render(<Run />); await screen.findByText('Next set');
  fireEvent.press(screen.getByText('Next set'));
  await waitFor(() => expect(saved.cursor).toBe(1));
  expect(mockStageLegacy).toHaveBeenCalledWith('A', expect.objectContaining({ cursor: 0, draft: expect.objectContaining({ reps: 8 }) }));
});


it('persists zero rest between superset exercises and the prescribed rest at the round boundary', async () => {
  saved = { ...saved, phase: 'work', draft: null, savedDraft: null, restUntilMs: null };
  const block = saved.day.blocks[0];
  block.kind = 'superset';
  block.rounds = 2;
  block.items.push({ ...block.items[0], id: 'item-2', exercise_id: 'unknown-2', item_index: 1 });
  const screen = render(<Run />);
  await screen.findByText('Complete set');
  fireEvent.press(screen.getByText('Complete set'));
  await screen.findByText('Next set');
  expect(saved.restUntilMs!).toBeLessThanOrEqual(Date.now());
  expect(screen.getByText('0:00')).toBeTruthy();
  fireEvent.press(screen.getByText('Next set'));
  await screen.findByText('Complete set');
  fireEvent.press(screen.getByText('Complete set'));
  await screen.findByText('Skip rest');
  expect(saved.restUntilMs! - Date.now()).toBeGreaterThan(85000);
  expect(saved.restUntilMs! - Date.now()).toBeLessThanOrEqual(90000);
});


it('ignores an older intra-round rest deadline when resuming a superset', async () => {
  saved = { ...saved, draft: saved.savedDraft, restUntilMs: Date.now() + 90000 };
  const block = saved.day.blocks[0];
  block.kind = 'superset';
  block.rounds = 2;
  block.items.push({ ...block.items[0], id: 'item-2', exercise_id: 'unknown-2', item_index: 1 });
  const screen = render(<Run />);
  await screen.findByText('Next set');
  expect(screen.getByText('0:00')).toBeTruthy();
  expect(screen.queryByText('Skip rest')).toBeNull();
});


it('seeds and queues the prescribed timed duration instead of rep history', async () => {
  saved = { ...saved, phase: 'work', draft: null, savedDraft: null, restUntilMs: null };
  saved.day.blocks[0].items[0].seconds = 40;
  const screen = render(<Run />);
  await screen.findByText('Complete set');
  fireEvent.press(screen.getByText('Complete set'));
  await screen.findByText('Skip rest');
  expect(mockSet).toHaveBeenCalledWith('A', 'session-A', expect.objectContaining({ seconds: 40, reps: null }));
  expect(saved.draft).toMatchObject({ seconds: 40, reps: 0 });
});
