import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import type { Plan, PlanDay } from '@/lib/types';

const mockReplace = jest.fn();
const mockQueueSet = jest.fn().mockResolvedValue(undefined);
const mockQueueCompletion = jest.fn().mockResolvedValue(undefined);
const mockGetActivePlan = jest.fn();
const mockGetProgress = jest.fn();
const mockGetWeightHistory = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ dayId: 'day', sessionId: 'session' }),
  useRouter: () => ({ replace: mockReplace, back: jest.fn() }),
}));
jest.mock('@/lib/auth', () => ({
  useUserId: () => 'user',
  useAuth: () => ({ profile: { units: 'kg', bodyweight_kg: 80 } }),
}));
jest.mock('@/lib/db/queries', () => ({
  getActivePlan: (...args: unknown[]) => mockGetActivePlan(...args),
  getProgress: (...args: unknown[]) => mockGetProgress(...args),
  getWeightHistory: (...args: unknown[]) => mockGetWeightHistory(...args),
}));
jest.mock('@/lib/session/sync', () => ({
  queueSet: (...args: unknown[]) => mockQueueSet(...args),
  queueCompletion: (...args: unknown[]) => mockQueueCompletion(...args),
  flushOutbox: () => Promise.resolve(),
  pendingSyncCount: () => Promise.resolve(0),
}));
jest.mock('@/components/ExerciseMedia', () => ({ ExerciseMedia: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const day: PlanDay = {
  id: 'day', day_index: 0, name: 'Push A', focus: 'Full body',
  blocks: [
    {
      id: 'warmup', block_index: 0, kind: 'warmup', title: 'Warm-up',
      rounds: 1, rest_seconds: 0, duration_seconds: 300,
      items: [{
        id: 'warmup-item', item_index: 0, exercise_id: 'Bodyweight_Squat',
        sets: 1, reps_low: 0, reps_high: 0, seconds: 300, tempo: null, notes: null,
      }],
    },
    ...[360, 960, 840, 360].map((duration_seconds, index) => ({
      id: `block-${index}`, block_index: index + 1, kind: 'straight' as const,
      title: `Block ${index + 1}`, rounds: 1, rest_seconds: 30, duration_seconds,
      items: [{
        id: `item-${index}`, item_index: 0, exercise_id: 'Barbell_Bench_Press_-_Medium_Grip',
        sets: 1, reps_low: 6, reps_high: 8, seconds: null, tempo: null, notes: null,
      }],
    })),
  ],
};
const plan: Plan = { id: 'plan', name: 'Timed PPL', split: 'PPL', weeks: 6, days: [day] };
const SessionRun = require('@/app/session/[dayId]/run').default;
const SessionOverview = require('@/app/session/[dayId]/index').default;

describe('timed workout player', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-21T12:00:00Z'));
    jest.clearAllMocks();
    mockGetActivePlan.mockResolvedValue(plan);
    mockGetProgress.mockResolvedValue(new Map([['Barbell_Bench_Press_-_Medium_Grip', {
      exercise_id: 'Barbell_Bench_Press_-_Medium_Grip', last_weight_kg: 42.5, last_reps: 8,
      best_weight_kg: 40, best_e1rm: null, miss_streak: 0,
    }]]));
    mockGetWeightHistory.mockResolvedValue(new Map([['Barbell_Bench_Press_-_Medium_Grip', {
      exerciseId: 'Barbell_Bench_Press_-_Medium_Grip', sessionId: 'previous',
      weightKg: 40, reps: 8, completedAt: '2026-10-18T12:00:00Z', isBodyweight: false,
    }]]));
  });
  afterEach(() => jest.useRealTimers());

  it('shows the 47-minute target and an absolute block countdown', async () => {
    const screen = render(<SessionRun />);
    await waitFor(() => expect(screen.getByText('47:00 target')).toBeTruthy());
    expect(screen.getByText('5:00 remaining')).toBeTruthy();
    act(() => jest.advanceTimersByTime(30_000));
    expect(screen.getByText('4:30 remaining')).toBeTruthy();
    expect(screen.getByText('0:30 elapsed')).toBeTruthy();
  });

  it('pauses and resumes the session and block clocks', async () => {
    const screen = render(<SessionRun />);
    await waitFor(() => expect(screen.getByLabelText('Pause timers')).toBeTruthy());
    act(() => jest.advanceTimersByTime(10_000));
    fireEvent.press(screen.getByLabelText('Pause timers'));
    act(() => jest.advanceTimersByTime(40_000));
    expect(screen.getByText('4:50 remaining')).toBeTruthy();
    expect(screen.getByText('0:10 elapsed')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Resume timers'));
    act(() => jest.advanceTimersByTime(10_000));
    expect(screen.getByText('4:40 remaining')).toBeTruthy();
    expect(screen.getByText('0:20 elapsed')).toBeTruthy();
  });

  it('keeps unfinished exercises on screen after the block timer expires', async () => {
    const screen = render(<SessionRun />);
    await waitFor(() => expect(screen.getByText('5:00 remaining')).toBeTruthy());
    act(() => jest.advanceTimersByTime(305_000));
    expect(screen.getByText('0:05 overtime')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(mockQueueSet).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('keeps recovery inside the block before starting the next countdown', async () => {
    const screen = render(<SessionRun />);
    await waitFor(() => expect(screen.getByText('Done')).toBeTruthy());
    fireEvent.press(screen.getByText('Done'));
    expect(screen.getByText('Block complete · recover')).toBeTruthy();
    expect(screen.getByText('5:00 remaining')).toBeTruthy();
    fireEvent.press(screen.getByText('Skip rest'));
    await waitFor(() => expect(screen.getByText('6:00 remaining')).toBeTruthy());
    expect(screen.getByText('Complete set')).toBeTruthy();
    expect(mockQueueSet).not.toHaveBeenCalled();
  });

  it('saves only a manually completed set and retains editable logging during recovery', async () => {
    const screen = render(<SessionRun />);
    await waitFor(() => expect(screen.getByText('Done')).toBeTruthy());
    fireEvent.press(screen.getByText('Done'));
    fireEvent.press(screen.getByText('Skip rest'));
    await act(async () => { fireEvent.press(screen.getByText('Complete set')); });
    await waitFor(() => expect(mockQueueSet).toHaveBeenCalledTimes(1));
    expect(mockQueueSet).toHaveBeenCalledWith('session', expect.objectContaining({
      plan_item_id: 'item-0', reps: 8, set_index: 1,
    }));
    expect(screen.getByText('Reps')).toBeTruthy();
    expect(screen.getByText('Weight')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Pause timers'));
    act(() => jest.advanceTimersByTime(10_000));
    expect(screen.getByText('6:00 remaining')).toBeTruthy();
  });

  it('retains the final core recovery before completing the session', async () => {
    mockGetActivePlan.mockResolvedValue({ ...plan, days: [{ ...day, blocks: [day.blocks[4]] }] });
    const screen = render(<SessionRun />);
    await waitFor(() => expect(screen.getByText('Complete set')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByText('Complete set')); });
    await waitFor(() => expect(screen.getByText('Block complete · recover')).toBeTruthy());
    expect(screen.getByText('Skip rest')).toBeTruthy();
    expect(mockQueueCompletion).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(360_000));
    expect(screen.getByText('Finish session')).toBeTruthy();
    expect(mockQueueCompletion).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Finish session'));
    await waitFor(() => expect(mockQueueCompletion).toHaveBeenCalledWith('session', 360));
  });

  it('records a timed hold without inventing reps or offering a reps stepper', async () => {
    const holdBlock = day.blocks[4];
    mockGetActivePlan.mockResolvedValue({ ...plan, days: [{ ...day, blocks: [{
      ...holdBlock, items: [{ ...holdBlock.items[0], seconds: 30, reps_low: 0, reps_high: 0 }],
    }] }] });
    const screen = render(<SessionRun />);
    await waitFor(() => expect(screen.getByText('Complete set')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByText('Complete set')); });
    await waitFor(() => expect(mockQueueSet).toHaveBeenCalledWith('session', expect.objectContaining({ reps: null })));
    expect(screen.queryByText('Reps')).toBeNull();
    expect(screen.getByText('Timed set · 30s target')).toBeTruthy();
  });

  it('shows block durations and the session target before beginning', async () => {
    const screen = render(<SessionOverview />);
    await waitFor(() => expect(screen.getByText('47 min target · 4 timed blocks')).toBeTruthy());
    expect(screen.getByText('Warm-up · 5:00')).toBeTruthy();
    expect(screen.getByText('Block 1 · 6:00')).toBeTruthy();
    expect(screen.getByText('Block 2 · 16:00')).toBeTruthy();
  });

  it('previews the actual next exercise in a circuit rotation', async () => {
    const block = day.blocks[1];
    const ids = ['Bodyweight_Squat', 'Barbell_Bench_Press_-_Medium_Grip', 'Barbell_Curl'];
    mockGetActivePlan.mockResolvedValue({ ...plan, days: [{ ...day, blocks: [{
      ...block, kind: 'circuit', rounds: 2,
      items: ids.map((exercise_id, index) => ({ ...block.items[0], id: `circuit-${index}`, exercise_id })),
    }] }] });
    const screen = render(<SessionRun />);
    await waitFor(() => expect(screen.getByText('Complete set')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByText('Complete set')); });
    await waitFor(() => expect(screen.getByText('Skip rest')).toBeTruthy());
    fireEvent.press(screen.getByText('Skip rest'));
    expect(screen.getByText('Barbell Curl')).toBeTruthy();
  });

  it('shows an editable suggestion before lifting and compares actual weights after the final set', async () => {
    mockGetActivePlan.mockResolvedValue({ ...plan, days: [{ ...day, blocks: [day.blocks[1]] }] });
    const screen = render(<SessionRun />);
    await waitFor(() => expect(screen.getByText('Suggested weight')).toBeTruthy());
    expect(screen.getByLabelText('Weight to use (kg)').props.value).toBe('42.5');
    expect(screen.queryByText('Exercise complete')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Weight to use (kg)'), '45');
    await act(async () => { fireEvent.press(screen.getByText('Complete set')); });
    expect(mockQueueSet).toHaveBeenCalledWith('session', expect.objectContaining({ weight_kg: 45 }));
    await waitFor(() => expect(screen.getByText('Exercise complete')).toBeTruthy());
    expect(screen.getByText('Previous workout: 40 kg')).toBeTruthy();
    expect(screen.getByText('+5 kg vs previous workout')).toBeTruthy();
    // Corrections replace this set, and keep the previous-session baseline.
    fireEvent.press(screen.getAllByLabelText('Increase')[1]);
    expect(screen.getByText('+7.5 kg vs previous workout')).toBeTruthy();
    expect(screen.getByText('Previous workout: 40 kg')).toBeTruthy();
    fireEvent.press(screen.getByText('Skip rest'));
    await waitFor(() => expect(mockQueueSet).toHaveBeenLastCalledWith('session', expect.objectContaining({ weight_kg: 47.5 })));
  });

  it('requires a personal starting weight when a loaded exercise has no history', async () => {
    mockGetProgress.mockResolvedValue(new Map());
    mockGetWeightHistory.mockResolvedValue(new Map());
    mockGetActivePlan.mockResolvedValue({ ...plan, days: [{ ...day, blocks: [day.blocks[1]] }] });
    const screen = render(<SessionRun />);
    await waitFor(() => expect(screen.getByText('Record your starting weight')).toBeTruthy());
    fireEvent.press(screen.getByText('Complete set'));
    expect(mockQueueSet).not.toHaveBeenCalled();
    fireEvent.changeText(screen.getByLabelText('Weight to use (kg)'), '20');
    await act(async () => { fireEvent.press(screen.getByText('Complete set')); });
    await waitFor(() => expect(screen.getByText('First recorded workout')).toBeTruthy());
    expect(mockQueueSet).toHaveBeenCalledWith('session', expect.objectContaining({ weight_kg: 20 }));
  });

  it('shows final-exercise feedback in a circuit only after its last round', async () => {
    const block = day.blocks[1];
    mockGetActivePlan.mockResolvedValue({ ...plan, days: [{ ...day, blocks: [{
      ...block, kind: 'circuit', rounds: 2,
      items: [block.items[0], { ...block.items[0], id: 'pullup', item_index: 1, exercise_id: 'Pullups' }],
    }] }] });
    const screen = render(<SessionRun />);
    await waitFor(() => expect(screen.getByText('Complete set')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByText('Complete set')); });
    expect(screen.queryByText('Exercise complete')).toBeNull();
    fireEvent.press(screen.getByText('Skip rest'));
    await act(async () => { fireEvent.press(screen.getByText('Complete set')); });
    expect(screen.queryByText('Exercise complete')).toBeNull();
    fireEvent.press(screen.getByText('Skip rest'));
    await act(async () => { fireEvent.press(screen.getByText('Complete set')); });
    await waitFor(() => expect(screen.getByText('Exercise complete')).toBeTruthy());
    expect(mockQueueSet).toHaveBeenCalledTimes(3);
  });

  it('allows manual weights when history fails without claiming a first workout', async () => {
    mockGetWeightHistory.mockRejectedValue(new Error('offline'));
    mockGetActivePlan.mockResolvedValue({ ...plan, days: [{ ...day, blocks: [day.blocks[1]] }] });
    const screen = render(<SessionRun />);
    await waitFor(() => expect(screen.getByLabelText('Weight to use (kg)')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByText('Complete set')); });
    await waitFor(() => expect(screen.getByText('Previous workout unavailable')).toBeTruthy());
    expect(screen.queryByText('First recorded workout')).toBeNull();
  });

  it('keeps bodyweight and external-load comparisons separate after correcting the load mode', async () => {
    const exercise_id = 'Pullups';
    mockGetProgress.mockResolvedValue(new Map([[exercise_id, {
      exercise_id, last_weight_kg: 10, last_reps: 8, best_weight_kg: 90, best_e1rm: null, miss_streak: 0,
    }]]));
    mockGetWeightHistory.mockResolvedValue(new Map([[exercise_id, {
      exerciseId: exercise_id, sessionId: 'previous', weightKg: 10, reps: 8,
      completedAt: '2026-10-18T12:00:00Z', isBodyweight: true,
    }]]));
    mockGetActivePlan.mockResolvedValue({ ...plan, days: [{ ...day, blocks: [{
      ...day.blocks[1], items: [{ ...day.blocks[1].items[0], exercise_id }],
    }] }] });
    const screen = render(<SessionRun />);
    await waitFor(() => expect(screen.getByText('Suggested added load')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByText('Complete set')); });
    await waitFor(() => expect(screen.getByText('Exercise complete')).toBeTruthy());
    fireEvent.press(screen.getByText('Bodyweight'));
    expect(screen.getByText('Previous workout unavailable')).toBeTruthy();
    expect(screen.queryByText(/vs previous workout/)).toBeNull();
  });
});
