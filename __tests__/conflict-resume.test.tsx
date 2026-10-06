import { fireEvent, render, waitFor } from '@testing-library/react-native';
import Run from '@/app/session/[dayId]/run';
import { workouts } from '@/lib/session/workout';
import { flushOutbox, getSetConflicts, queueSet, resolveSetConflict, reviewSetConflict, setSyncAccount } from '@/lib/session/sync';
import type { SavedWorkout } from '@/lib/session/workout-store';
const owner = 'abababab-1111-4111-8111-abababababab';
const session = 'cdcdcdcd-1111-4111-8111-cdcdcdcdcdcd';
const item = '00000015-1111-4111-8111-000000000015';
const mockLog = jest.fn(), mockServer = jest.fn(), mockNotify = jest.fn();
let mockOrigin = 0;
let mockFailWorkout = false;
const mockRouter = { replace: jest.fn(), back: jest.fn() };
const mockValues = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (key: string) => mockValues.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    if (mockFailWorkout && key.startsWith('office-gym.active-workout')) { mockFailWorkout = false; throw new Error('disk full'); }
    mockValues.set(key, value);
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => `${String(++mockOrigin).padStart(8, '0')}-1111-4111-8111-999999999999` }), { virtual: true });
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: () => () => {} }));
jest.mock('@/lib/db/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: {
    user: { id: 'abababab-1111-4111-8111-abababababab' }, access_token: 'fixture' } }, error: null }) } },
  clientForAccessToken: () => ({}),
}));
jest.mock('@/lib/db/queries', () => ({
  logSetVersioned: (...args: unknown[]) => mockLog(...args),
  getSetWriteState: (...args: unknown[]) => mockServer(...args),
  getSessionSetSnapshot: async () => ({ logs: [{
    id: '00000099-1111-4111-8111-000000000099', plan_item_id: '00000015-1111-4111-8111-000000000015',
    exercise_id: 'unknown', set_index: 1, reps: 8, weight_kg: 60, is_bodyweight: false, added_load_kg: 0,
    rpe: null, completed_at: '2026-09-01T10:00:00.000Z',
  }], versions: [{ logId: '00000099-1111-4111-8111-000000000099', serverVersion: 7 }] }),
  getSessionResumeDetails: jest.fn(), getSessionPlanDay: jest.fn(), getProgress: jest.fn(), finishSession: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({
  useUserId: () => 'abababab-1111-4111-8111-abababababab',
  useAuth: () => ({ profile: { units: 'kg', bodyweight_kg: null } }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ dayId: 'day', sessionId: 'cdcdcdcd-1111-4111-8111-cdcdcdcdcdcd' }),
  useRouter: () => mockRouter,
}));
jest.mock('@/lib/alerts', () => ({ notify: (...args: unknown[]) => mockNotify(...args), confirm: async () => true }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
const fixture = (): SavedWorkout => ({
  version: 1, ownerId: owner, sessionId: session, units: 'kg', progress: [], cursor: 0, phase: 'resting',
  draft: { reps: 10, weight: 60, asBodyweight: false }, savedDraft: { reps: 8, weight: 60, asBodyweight: false },
  restUntilMs: Date.now() - 1000, startedAtMs: 1000, endedAtMs: null,
  day: { id: 'day', day_index: 0, name: 'Day', focus: 'Strength', blocks: [{
    id: 'block', block_index: 0, kind: 'straight', title: 'Work', rounds: 1, rest_seconds: 90,
    items: [{ id: item, item_index: 0, exercise_id: 'unknown', sets: 2, reps_low: 6, reps_high: 8,
      seconds: null, tempo: null, notes: null }],
  }] },
});
it('preserves the explicit server choice through a warm rest screen and a restarted resume', async () => {
  mockValues.clear(); setSyncAccount(owner);
  await workouts.create(fixture());
  const set = { plan_item_id: item, exercise_id: 'unknown', set_index: 1, reps: 8,
    weight_kg: 60, is_bodyweight: false, added_load_kg: 0, rpe: null };
  mockLog.mockRejectedValue({ code: 'PT409' });
  await queueSet(owner, session, set); await flushOutbox();
  const warm = render(<Run />);
  await warm.findByText('10');
  const [blocked] = await getSetConflicts(owner);
  mockServer.mockResolvedValue({ serverVersion: 4, set: { ...set, reps: 12 }, eventAt: '2026-10-06T11:00:00Z' });
  const review = await reviewSetConflict(owner, blocked.write);
  mockLog.mockResolvedValue({ status: 'applied', serverVersion: 5 });
  await resolveSetConflict(owner, review, 'server'); await flushOutbox();
  const writes = mockLog.mock.calls.length;
  fireEvent.press(warm.getByText('Next set'));
  await waitFor(() => expect(mockNotify).toHaveBeenCalledWith('Could not save workout', expect.stringMatching(/changed/)));
  expect(mockLog).toHaveBeenCalledTimes(writes);
  expect((await workouts.read(owner))?.cursor).toBe(0);
  warm.unmount();
  const resumed = render(<Run />);
  await resumed.findByText('12');
  fireEvent.press(resumed.getByText('Next set'));
  await waitFor(async () => expect((await workouts.read(owner))?.cursor).toBe(1));
  expect(mockLog).toHaveBeenCalledTimes(writes);
  expect((await workouts.read(owner))?.progress[0].last_reps).toBe(12);
  fireEvent.press(await resumed.findByText('Complete set'));
  await resumed.findByText('Finish session');
  fireEvent.press(resumed.getByText('Finish session'));
  await waitFor(async () => expect((await workouts.read(owner))?.endedAtMs).not.toBeNull());
  expect((await workouts.read(owner))?.cursor).toBe(2);
  await workouts.clear(owner, session);
  const comparisons = JSON.parse(mockValues.get(`office-gym.set-journal.v1.${owner}`)!).comparisons;
  expect(comparisons[0].draftCopy).toMatchObject({ units: 'kg', draft: { reps: 10 }, savedDraft: { reps: 8 } });
});

it('retries an optimistic draft after a transient disk failure without reopening or losing it', async () => {
  mockValues.clear(); setSyncAccount(owner); mockLog.mockResolvedValue({ status: 'applied', serverVersion: 1 });
  await workouts.create(fixture());
  const screen = render(<Run />); await screen.findByText('10');
  mockFailWorkout = true;
  fireEvent.press(screen.getAllByLabelText('Increase')[0]);
  await screen.findByText('disk full');
  expect(screen.getByText('11')).toBeTruthy();
  fireEvent.press(screen.getByText('Next set'));
  await waitFor(async () => expect((await workouts.read(owner))?.cursor).toBe(1));
  expect((await workouts.read(owner))?.progress[0].last_reps).toBe(11);
});
