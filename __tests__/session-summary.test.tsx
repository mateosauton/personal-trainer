import { render, waitFor } from '@testing-library/react-native';

import { gymExerciseId } from '@/lib/data/gym-routine-exercises';
import type { Plan } from '@/lib/types';

const mockApplySessionProgress = jest.fn().mockResolvedValue(undefined);
let mockUnits: 'kg' | 'lb' = 'kg';
const exerciseId = gymExerciseId('Bulgarian split squat');
const mockLogs = [1, 2].map((set_index) => ({
  plan_item_id: 'item', exercise_id: exerciseId, set_index,
  reps: 4, weight_kg: 10, is_bodyweight: false, added_load_kg: 0, rpe: null,
}));
const mockPlan: Plan = {
  id: 'plan', name: 'Legs A', split: 'PPL', weeks: 6,
  days: [{
    id: 'day', day_index: 0, name: 'Legs A', focus: 'Legs',
    blocks: [{
      id: 'block', block_index: 0, kind: 'straight', title: 'Strength', rounds: 1,
      rest_seconds: 90,
      items: [{
        id: 'item', item_index: 0, exercise_id: exerciseId, sets: 2,
        reps_low: 4, reps_high: 6, seconds: null, tempo: null, notes: 'Per side',
      }],
    }],
  }],
};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ dayId: 'day', sessionId: 'session', elapsed: '2820' }),
  useRouter: () => ({ replace: jest.fn() }),
}));
jest.mock('@/lib/auth', () => ({
  useUserId: () => 'user',
  useAuth: () => ({ profile: { units: mockUnits, bodyweight_kg: 80 } }),
}));
jest.mock('@/lib/db/queries', () => ({
  getSessionSetSnapshot: async () => ({ logs: mockLogs, versions: [] }),
  getSessionProgressResult: async () => null,
  getSessionPlanDay: async () => mockPlan.days[0],
  applySessionProgress: (...args: unknown[]) => mockApplySessionProgress(...args),
  getProgress: () => Promise.resolve(new Map([[mockLogs[0].exercise_id, {
    last_weight_kg: 10, last_reps: 4, best_weight_kg: 20, best_e1rm: null, miss_streak: 0,
  }]])),
}));
jest.mock('@/lib/session/sync', () => ({
  flushOutbox: async () => undefined,
  failedSyncCount: async () => 0,
  pendingSyncCount: async () => 0,
}));
jest.mock('@/lib/session/workout', () => ({ workouts: { read: async () => null, clear: async () => undefined } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const SessionSummary = require('@/app/session/[dayId]/summary').default;

beforeEach(() => {
  mockUnits = 'kg';
  mockLogs.forEach((log) => { log.reps = 4; });
  jest.clearAllMocks();
  mockApplySessionProgress.mockImplementation(async (_session, _expected, _updates, lines) => lines);
});

it('shows both-side tonnage without doubling reps used for load progression', async () => {
  const screen = render(<SessionSummary />);
  await waitFor(() => expect(screen.getByText('160 kg')).toBeTruthy());
  expect(mockApplySessionProgress).toHaveBeenCalledWith('session', expect.any(Array), [expect.objectContaining({
    last_reps: 4, last_weight_kg: 10, best_e1rm: 10 * (1 + 4 / 30),
  })], expect.any(Array), expect.any(Array));
  expect(mockLogs.map((log) => log.reps)).toEqual([4, 4]);
});

it('uses pound increments for the next suggested weight when the profile uses pounds', async () => {
  mockUnits = 'lb';
  mockLogs.forEach((log) => { log.reps = 6; });
  render(<SessionSummary />);
  await waitFor(() => expect(mockApplySessionProgress).toHaveBeenCalled());
  const rows = mockApplySessionProgress.mock.calls[0][2];
  expect(rows[0].last_weight_kg).toBeCloseTo(10 + 10 / 2.2046226218);
});
