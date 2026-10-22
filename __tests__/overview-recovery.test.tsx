import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import Overview from '@/app/session/[dayId]/index';
import { planCache } from '@/lib/session/plan-cache';
import type { Plan, PlanDay } from '@/lib/types';
const mockStartWorkout = jest.fn(), mockGetPlan = jest.fn(), mockGetProgress = jest.fn(), mockReplace = jest.fn();
const mockRouter = { replace: mockReplace, back: jest.fn() };
let mockOwner = 'A', mockDayId = 'day';
const day: PlanDay = { id: 'day', day_index: 0, name: 'Training', focus: 'Strength', blocks: [] };
const plan: Plan = { id: 'plan', name: 'Strength', split: 'Full body', weeks: 4, days: [day] };
const progress = { exercise_id: 'press', last_weight_kg: 50, last_reps: 8,
  best_weight_kg: 50, best_e1rm: 63, miss_streak: 0 };
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/lib/auth', () => ({
  useUserId: () => mockOwner,
  useAuth: () => ({ profile: { units: 'lb', bodyweight_kg: 70 } }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ dayId: mockDayId }),
  useRouter: () => mockRouter,
}));
jest.mock('@/lib/session/sync', () => ({
  startWorkout: (...args: unknown[]) => mockStartWorkout(...args),
}));
jest.mock('@/lib/db/queries', () => ({
  getActivePlan: (...args: unknown[]) => mockGetPlan(...args),
  getProgress: (...args: unknown[]) => mockGetProgress(...args),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockOwner = 'A';
  mockDayId = 'day';
  mockGetPlan.mockResolvedValue(plan);
  mockGetProgress.mockResolvedValue(new Map([['press', progress]]));
  mockStartWorkout.mockImplementation(async (_owner, selected) => ({ day: selected, sessionId: 'local-session' }));
});
it('starts from the loaded prescription and progress through the durable start operation', async () => {
  const screen = render(<Overview />);
  await waitFor(() => expect(screen.getByText('Begin')).toBeTruthy());
  fireEvent.press(screen.getByText('Begin'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/session/[dayId]/run',
    params: { dayId: 'day', sessionId: 'local-session' } }));
  expect(mockStartWorkout).toHaveBeenCalledWith('A', day,
    { units: 'lb', bodyweightKg: 70, progress: [progress] });
});
it('uses the cached prescription and progress when the app opens offline', async () => {
  await planCache.write('A', plan, [progress]);
  mockGetPlan.mockRejectedValue(new Error('Offline'));
  mockGetProgress.mockRejectedValue(new Error('Offline'));
  const screen = render(<Overview />);
  await waitFor(() => expect(screen.getByText('Training')).toBeTruthy());
  fireEvent.press(screen.getByText('Begin'));
  await waitFor(() => expect(mockStartWorkout).toHaveBeenCalledWith('A', day,
    { units: 'lb', bodyweightKg: 70, progress: [progress] }));
});
it('retains a successful plan read when progress is unavailable and falls back to cached progress', async () => {
  await planCache.write('A', plan, [progress]);
  const updatedDay = { ...day, name: 'Updated training' };
  mockGetPlan.mockResolvedValue({ ...plan, days: [updatedDay] });
  mockGetProgress.mockRejectedValue(new Error('Progress unavailable'));
  const screen = render(<Overview />);
  await waitFor(() => expect(screen.getByText('Updated training')).toBeTruthy());
  fireEvent.press(screen.getByText('Begin'));
  await waitFor(() => expect(mockStartWorkout).toHaveBeenCalledWith('A', updatedDay,
    { units: 'lb', bodyweightKg: 70, progress: [progress] }));
});
it('starts with empty progress when the online plan succeeds without a progress cache', async () => {
  mockGetProgress.mockRejectedValue(new Error('Progress unavailable'));
  const screen = render(<Overview />);
  await waitFor(() => expect(screen.getByText('Begin')).toBeTruthy());
  fireEvent.press(screen.getByText('Begin'));
  await waitFor(() => expect(mockStartWorkout).toHaveBeenCalledWith('A', day,
    { units: 'lb', bodyweightKg: 70, progress: [] }));
});
it('does not use another account cache and preserves the network error', async () => {
  await planCache.write('B', plan, [progress]);
  mockGetPlan.mockRejectedValue(new Error('Plan connection failed'));
  mockGetProgress.mockRejectedValue(new Error('Progress connection failed'));
  const screen = render(<Overview />);
  await waitFor(() => expect(screen.getByText('Plan connection failed')).toBeTruthy());
  expect(screen.queryByText('Begin')).toBeNull();
});
it('does not revive a cached plan after the server confirms it is inactive', async () => {
  await planCache.write('A', plan, [progress]);
  mockGetPlan.mockResolvedValue(null);
  const screen = render(<Overview />);
  await waitFor(() => expect(screen.getByText('That session is no longer in your plan.')).toBeTruthy());
  expect(await planCache.read('A')).toBeNull();
});
it.each(['account', 'day'])('ignores a delayed plan read after changing the %s', async (change) => {
  let resolve!: (value: Plan) => void;
  mockGetPlan.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const screen = render(<Overview />);
  await waitFor(() => expect(mockGetPlan).toHaveBeenCalledWith('A'));
  if (change === 'account') mockOwner = 'B';
  else mockDayId = 'next-day';
  const nextDay = { ...day, id: mockDayId, name: 'Current training' };
  mockGetPlan.mockResolvedValue({ ...plan, days: [nextDay] });
  screen.rerender(<Overview />);
  await waitFor(() => expect(screen.getByText('Current training')).toBeTruthy());
  await act(async () => { resolve(plan); });
  expect(screen.queryByText('Training')).toBeNull();
});
it.each(['account', 'unmount'])('does not navigate from a delayed start after %s changes', async (change) => {
  let resolve!: (value: unknown) => void;
  mockStartWorkout.mockReturnValue(new Promise((done) => { resolve = done; }));
  const screen = render(<Overview />);
  await waitFor(() => expect(screen.getByText('Begin')).toBeTruthy());
  fireEvent.press(screen.getByText('Begin'));
  await waitFor(() => expect(mockStartWorkout).toHaveBeenCalled());
  if (change === 'account') { mockOwner = 'B'; screen.rerender(<Overview />); }
  else screen.unmount();
  await act(async () => { resolve({ day, sessionId: 'A-session' }); });
  expect(mockReplace).not.toHaveBeenCalled();
});
it('shows durable-start errors and retries the same operation before navigating', async () => {
  mockStartWorkout.mockRejectedValueOnce(new Error('Disk unavailable'));
  const screen = render(<Overview />);
  await waitFor(() => expect(screen.getByText('Begin')).toBeTruthy());
  fireEvent.press(screen.getByText('Begin'));
  await waitFor(() => expect(screen.getByText('Retry start')).toBeTruthy());
  expect(mockReplace).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Retry start'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalled());
  expect(mockStartWorkout).toHaveBeenCalledTimes(2);
  expect(mockStartWorkout.mock.calls[1]).toEqual(mockStartWorkout.mock.calls[0]);
});

it('starts immediately from cache while both plan and progress requests never settle', async () => {
  await planCache.write('A', plan, [progress]);
  mockGetPlan.mockReturnValue(new Promise(() => {}));
  mockGetProgress.mockReturnValue(new Promise(() => {}));
  const screen = render(<Overview />);
  await waitFor(() => expect(screen.getByText('Begin')).toBeTruthy());
  expect(screen.getByText('Using your saved plan. Your workout will sync when you reconnect.')).toBeTruthy();
  fireEvent.press(screen.getByText('Begin'));
  await waitFor(() => expect(mockStartWorkout).toHaveBeenCalledWith('A', day,
    { units: 'lb', bodyweightKg: 70, progress: [progress] }));
});
it('does not replace the current day with a delayed cache read from the previous day', async () => {
  let resolve!: (value: { plan: Plan; progress: typeof progress[] }) => void;
  const reading = jest.spyOn(planCache, 'read')
    .mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
    .mockResolvedValueOnce(null);
  const screen = render(<Overview />);
  await waitFor(() => expect(reading).toHaveBeenCalledWith('A'));
  mockDayId = 'next-day';
  const nextDay = { ...day, id: 'next-day', name: 'Current training' };
  mockGetPlan.mockResolvedValue({ ...plan, days: [nextDay] });
  screen.rerender(<Overview />);
  await waitFor(() => expect(screen.getByText('Current training')).toBeTruthy());
  await act(async () => { resolve({ plan, progress: [progress] }); });
  expect(screen.queryByText('Training')).toBeNull();
  expect(screen.getByText('Current training')).toBeTruthy();
  reading.mockRestore();
});

it('starts with winning confirmed progression after an older overview refresh finishes', async () => {
  await planCache.write('A', plan, [progress], 'day');
  let resolve!: (value: Plan) => void;
  mockGetPlan.mockReturnValue(new Promise((done) => { resolve = done; }));
  const screen = render(<Overview />);
  await waitFor(() => expect(mockGetPlan).toHaveBeenCalled());
  const confirmed = [{ ...progress, last_weight_kg: 55 }];
  await planCache.advanceAfterSession('A', 'day', confirmed);
  await act(async () => { resolve(plan); });
  fireEvent.press(screen.getByText('Begin'));
  await waitFor(() => expect(mockStartWorkout).toHaveBeenCalledWith('A', day,
    { units: 'lb', bodyweightKg: 70, progress: confirmed }));
  expect((await planCache.read('A'))?.progress).toEqual(confirmed);
});
it('keeps a newer cached plan when an older no-plan response finishes later', async () => {
  await planCache.write('A', plan, [progress], 'day');
  let resolve!: (value: null) => void;
  mockGetPlan.mockReturnValue(new Promise((done) => { resolve = done; }));
  const screen = render(<Overview />);
  await waitFor(() => expect(mockGetPlan).toHaveBeenCalled());
  const newerDay = { ...day, name: 'New plan training' };
  const newer = { ...plan, id: 'new-plan', days: [newerDay] };
  await planCache.write('A', newer, [progress], 'day');
  await act(async () => { resolve(null); });
  await waitFor(() => expect(screen.getByText('New plan training')).toBeTruthy());
  expect((await planCache.read('A'))?.plan.id).toBe('new-plan');
});
