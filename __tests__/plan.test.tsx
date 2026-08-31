import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { dayKey } from '@/lib/stats';
import type { Plan, PlanDay } from '@/lib/types';

const mockState: { value: Record<string, unknown> } = { value: {} };
const mockGetSetLogs = jest.fn().mockResolvedValue([
  { session_id: 's1', exercise_id: 'barbell-bench-press', reps: 8, weight_kg: 60, is_bodyweight: false, added_load_kg: 0 },
]);

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ profile: { display_name: 'Mateo', units: 'kg', bodyweight_kg: 80 } }),
  useUserId: () => 'test-user',
}));

jest.mock('@/lib/useDashboard', () => ({ useDashboard: () => mockState.value }));

jest.mock('@/lib/db/queries', () => ({
  getSetLogsForSessions: (...args: unknown[]) => mockGetSetLogs(...args),
}));

jest.mock('@/components/ExerciseMedia', () => ({ ExerciseMedia: () => null }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useFocusEffect: () => undefined,
}));

const day: PlanDay = {
  id: 'day-1',
  day_index: 0,
  name: 'Push A',
  focus: 'Chest and shoulders',
  blocks: [
    {
      id: 'b1', block_index: 0, kind: 'straight', title: 'Block 1 · Press',
      rounds: 1, rest_seconds: 90,
      items: [
        {
          id: 'i1', item_index: 0, exercise_id: 'barbell-bench-press',
          sets: 4, reps_low: 6, reps_high: 8, seconds: null, tempo: null, notes: null,
        },
      ],
    },
  ],
};

const plan: Plan = { id: 'p1', name: 'Block 1', split: 'Upper/Lower', weeks: 4, days: [day] };
const today = dayKey(new Date());

const session = {
  id: 's1',
  started_at: new Date().toISOString(),
  local_day: today,
  duration_s: 2400,
  rpe: 8,
  plan_days: { name: 'Push A', focus: 'Chest and shoulders' },
};

const PlanTab = require('@/app/(tabs)/plan').default;

const state = {
  plan,
  nextDay: day,
  completedCount: 1,
  sessions: [session],
  trainedDays: new Set([today]),
  streak: 1,
  todaySessions: [session],
  todayTotals: null,
  lastLoadKg: new Map(),
  loading: false,
  error: null,
  reload: jest.fn(),
};

describe('Plan tab', () => {
  beforeEach(() => {
    mockState.value = state;
  });

  it('marks trained days on the calendar', () => {
    const { getByTestId } = render(<PlanTab />);
    expect(getByTestId(`calendar-trained-${today}`)).toBeTruthy();
  });

  it('opens the session that filled a trained day', async () => {
    const { getByTestId, getAllByText, getByText } = render(<PlanTab />);

    fireEvent.press(getByTestId(`calendar-trained-${today}`));

    // History content now lives here: duration, RPE, and the totals.
    await waitFor(() => expect(getAllByText(/40 min/).length).toBeGreaterThan(0));
    expect(getAllByText('Push A').length).toBeGreaterThan(0);
    expect(getByText('Volume')).toBeTruthy();
  });

  it('describes each session in the plan', () => {
    const { getByText, getAllByText } = render(<PlanTab />);

    expect(getByText('Est. min')).toBeTruthy();
    expect(getByText('Blocks')).toBeTruthy();
    expect(getAllByText('28').length).toBeGreaterThan(0); // 4 x mid(6,8) reps
  });

  it('expands a session into its blocks and exercises', () => {
    const { getByLabelText, queryByText, getByText } = render(<PlanTab />);

    expect(queryByText('Block 1 · Press')).toBeNull();
    fireEvent.press(getByLabelText('Push A details'));
    expect(getByText('Block 1 · Press')).toBeTruthy();
    expect(getByText('4 × 6–8')).toBeTruthy();
  });

  it('keeps the history list on the same screen', () => {
    const { getByText } = render(<PlanTab />);
    expect(getByText('Recent')).toBeTruthy();
  });
});
