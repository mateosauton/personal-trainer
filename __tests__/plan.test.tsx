import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { dayKey } from '@/lib/stats';
import type { Plan, PlanDay } from '@/lib/types';

const mockState: { value: Record<string, unknown> } = { value: {} };
const mockGetSetLogs = jest.fn().mockResolvedValue([
  { session_id: 's1', exercise_id: 'barbell-bench-press', reps: 8, weight_kg: 60, is_bodyweight: false, added_load_kg: 0 },
]);
const mockSavePlan = jest.fn().mockResolvedValue('gym-plan');
const mockGymPlan = { name: 'Gym PPL · 47 min', split: 'Gym PPL · 6-session rotation', weeks: 6, days: [] };

jest.mock('@/lib/plan/gym-routine', () => ({
  generateGymRoutine: () => mockGymPlan,
  isGymRoutine: (value: { split: string }) => value.split === 'Gym PPL · 6-session rotation',
}));

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ profile: { display_name: 'Mateo', units: 'kg', bodyweight_kg: 80 } }),
  useUserId: () => 'test-user',
}));

jest.mock('@/lib/useDashboard', () => ({ useDashboard: () => mockState.value }));

jest.mock('@/lib/db/queries', () => ({
  getSetLogsForSessions: (...args: unknown[]) => mockGetSetLogs(...args),
  savePlan: (...args: unknown[]) => mockSavePlan(...args),
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
    mockSavePlan.mockClear().mockResolvedValue('gym-plan');
    state.reload.mockClear();
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

  it('activates the timed gym routine and reloads the saved plan', async () => {
    const { getByText } = render(<PlanTab />);
    fireEvent.press(getByText('Use 47 min PPL routine'));
    await waitFor(() => expect(mockSavePlan).toHaveBeenCalledWith('test-user', mockGymPlan));
    expect(state.reload).toHaveBeenCalledTimes(1);
    expect(getByText('Recent')).toBeTruthy();
  });

  it('offers the routine when there is no active plan', async () => {
    mockState.value = { ...state, plan: null, nextDay: null };
    const { getByText } = render(<PlanTab />);
    fireEvent.press(getByText('Use 47 min PPL routine'));
    await waitFor(() => expect(mockSavePlan).toHaveBeenCalledTimes(1));
  });

  it('shows an activation error without claiming the routine is active', async () => {
    mockSavePlan.mockRejectedValueOnce(new Error('Could not save routine'));
    const { getByText } = render(<PlanTab />);
    fireEvent.press(getByText('Use 47 min PPL routine'));
    await waitFor(() => expect(getByText('Could not save routine')).toBeTruthy());
    expect(state.reload).not.toHaveBeenCalled();
    expect(getByText('Use 47 min PPL routine')).toBeTruthy();
  });

  it('describes six sessions as a rotation rather than six days a week', () => {
    const timed = {
      ...plan, split: 'Gym PPL · 6-session rotation', name: 'Gym PPL · 47 min',
      days: Array.from({ length: 6 }, (_, index) => ({ ...day, id: `day-${index}`, day_index: index })),
    };
    mockState.value = { ...state, plan: timed };
    const { getByText, queryByText } = render(<PlanTab />);
    expect(getByText(/6-session rotation/)).toBeTruthy();
    expect(queryByText(/6 days a week/)).toBeNull();
    expect(queryByText('Use 47 min PPL routine')).toBeNull();
  });

  it('describes allocated recovery instead of promising the old fixed rest', () => {
    const timedDay = { ...day, blocks: [{ ...day.blocks[0], duration_seconds: 960 }] };
    mockState.value = { ...state, plan: { ...plan, days: [timedDay] } };
    const { getByLabelText, getByText, queryByText } = render(<PlanTab />);
    fireEvent.press(getByLabelText('Push A details'));
    expect(getByText(/16:00 min · Straight sets · timed recovery/)).toBeTruthy();
    expect(queryByText(/rest 90s/)).toBeNull();
  });
});
