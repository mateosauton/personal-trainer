import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { planCache } from '@/lib/session/plan-cache';
import { useDashboard } from '@/lib/useDashboard';
import Home from '@/app/(tabs)/index';
import Overview from '@/app/session/[dayId]/index';
import type { Plan } from '@/lib/types';
const mockGetPlan = jest.fn(), mockGetProgress = jest.fn(), mockGetSessions = jest.fn(), mockGetDays = jest.fn();
const mockLastIndex = jest.fn(), mockSetLogs = jest.fn(), mockStartWorkout = jest.fn();
const mockPush = jest.fn(), mockReplace = jest.fn();
let mockOwner = 'A', mockDayId = 'day-1';
const mockRouter = { push: mockPush, replace: mockReplace, back: jest.fn() };
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/lib/db/queries', () => ({
  getActivePlan: (...args: unknown[]) => mockGetPlan(...args),
  getProgress: (...args: unknown[]) => mockGetProgress(...args),
  getRecentSessions: (...args: unknown[]) => mockGetSessions(...args),
  getTrainedDayKeys: (...args: unknown[]) => mockGetDays(...args),
  getLastCompletedPlanDayIndex: (...args: unknown[]) => mockLastIndex(...args),
  getSetLogsForSessions: (...args: unknown[]) => mockSetLogs(...args),
}));
jest.mock('@/lib/auth', () => ({
  useUserId: () => mockOwner,
  useAuth: () => ({ profile: { units: 'kg', bodyweight_kg: 70, display_name: 'Mateo' } }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ dayId: mockDayId }),
  useFocusEffect: () => undefined,
}));
jest.mock('@/components/SyncRecovery', () => ({ SyncRecovery: () => null }));
jest.mock('@/lib/session/workout', () => ({ workouts: { read: async () => null } }));
jest.mock('@/lib/session/sync', () => ({ startWorkout: (...args: unknown[]) => mockStartWorkout(...args) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
const plan: Plan = { id: 'plan', name: 'Strength', split: 'Full body', weeks: 4,
  days: [0, 1].map((index) => ({ id: `day-${index}`, day_index: index, name: `Training ${index}`,
    focus: 'Strength', blocks: [] })) };
const progress = { exercise_id: 'press', last_weight_kg: 50, last_reps: 8,
  best_weight_kg: 50, best_e1rm: 63, miss_streak: 0 };
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockOwner = 'A';
  mockDayId = 'day-1';
  mockGetPlan.mockResolvedValue(plan);
  mockGetProgress.mockResolvedValue(new Map([['press', progress]]));
  mockGetSessions.mockResolvedValue([]);
  mockGetDays.mockResolvedValue([]);
  mockLastIndex.mockResolvedValue(0);
  mockSetLogs.mockResolvedValue([]);
  mockStartWorkout.mockResolvedValue({ day: plan.days[1], sessionId: 'local-session' });
});
function goOffline() {
  for (const query of [mockGetPlan, mockGetProgress, mockGetSessions, mockGetDays])
    query.mockRejectedValue(new Error('Offline'));
}
it('caches the active prescription and rotation even when history fails', async () => {
  mockGetSessions.mockRejectedValue(new Error('History unavailable'));
  const { result } = renderHook(() => useDashboard('A', 70));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(await planCache.read('A')).toEqual({ plan, progress: [progress], nextDayId: 'day-1' });
});
it('opens the cached next workout from Home after a cold offline restart', async () => {
  const online = renderHook(() => useDashboard('A', 70));
  await waitFor(() => expect(online.result.current.loading).toBe(false));
  online.unmount();
  goOffline();
  const home = render(<Home />);
  await waitFor(() => expect(home.getByText('Start session')).toBeTruthy());
  expect(home.getByText('Training 1')).toBeTruthy();
  expect(home.getByText('Using your saved plan. History will load when you reconnect.')).toBeTruthy();
  expect(home.queryByText('Days trained')).toBeNull();
  fireEvent.press(home.getByText('Start session'));
  expect(mockPush).toHaveBeenCalledWith('/session/day-1');
  home.unmount();
  const overview = render(<Overview />);
  await waitFor(() => expect(overview.getByText('Begin')).toBeTruthy());
  fireEvent.press(overview.getByText('Begin'));
  await waitFor(() => expect(mockStartWorkout).toHaveBeenCalledWith('A', plan.days[1],
    { units: 'kg', bodyweightKg: 70, progress: [progress] }));
  expect(mockReplace).toHaveBeenCalledWith({ pathname: '/session/[dayId]/run',
    params: { dayId: 'day-1', sessionId: 'local-session' } });
});
it('does not expose a previous account plan after an offline account switch', async () => {
  const { result, rerender } = renderHook<ReturnType<typeof useDashboard>, { owner: string }>(({ owner }) => useDashboard(owner, 70), { initialProps: { owner: 'A' } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  goOffline();
  rerender({ owner: 'B' });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.plan).toBeNull();
  expect(result.current.nextDay).toBeNull();
  expect(result.current.lastLoadKg.size).toBe(0);
});

it('starts the cached workout from Home while remote requests never settle', async () => {
  await planCache.write('A', plan, [progress], 'day-1');
  for (const query of [mockGetPlan, mockGetProgress, mockGetSessions, mockGetDays])
    query.mockReturnValue(new Promise(() => {}));
  const home = render(<Home />);
  await waitFor(() => expect(home.getByText('Start session')).toBeTruthy());
  expect(home.getByText('Training 1')).toBeTruthy();
  expect(home.getByText('Using your saved plan. History will load when you reconnect.')).toBeTruthy();
  expect(home.queryByText('Days trained')).toBeNull();
  fireEvent.press(home.getByText('Start session'));
  expect(mockPush).toHaveBeenCalledWith('/session/day-1');
  home.unmount();
  const overview = render(<Overview />);
  await waitFor(() => expect(overview.getByText('Begin')).toBeTruthy());
  fireEvent.press(overview.getByText('Begin'));
  await waitFor(() => expect(mockStartWorkout).toHaveBeenCalledWith('A', plan.days[1],
    { units: 'kg', bodyweightKg: 70, progress: [progress] }));
});
it('replaces the initial cached dashboard with the completed network refresh', async () => {
  await planCache.write('A', plan, [progress], 'day-1');
  let resolve!: (value: Plan) => void;
  mockGetPlan.mockReturnValue(new Promise((done) => { resolve = done; }));
  mockLastIndex.mockResolvedValue(1);
  const { result } = renderHook(() => useDashboard('A', 70));
  await waitFor(() => expect(result.current.usingCachedPlan).toBe(true));
  expect(result.current.nextDay?.id).toBe('day-1');
  const refreshed = { ...plan, name: 'Refreshed strength' };
  await act(async () => { resolve(refreshed); });
  await waitFor(() => expect(result.current.usingCachedPlan).toBe(false));
  expect(result.current.plan?.name).toBe('Refreshed strength');
  expect(result.current.nextDay?.id).toBe('day-0');
});
it('ignores a delayed cache read from a previous account after the current refresh succeeds', async () => {
  let resolve!: (value: { plan: Plan; progress: typeof progress[]; nextDayId: string }) => void;
  const reading = jest.spyOn(planCache, 'read')
    .mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
    .mockResolvedValueOnce(null);
  const { result, rerender } = renderHook<ReturnType<typeof useDashboard>, { owner: string }>(
    ({ owner }) => useDashboard(owner, 70), { initialProps: { owner: 'A' } });
  await waitFor(() => expect(reading).toHaveBeenCalledWith('A'));
  const currentPlan = { ...plan, id: 'plan-B', name: 'Current training' };
  mockGetPlan.mockResolvedValue(currentPlan);
  rerender({ owner: 'B' });
  await waitFor(() => expect(result.current.plan?.id).toBe('plan-B'));
  await act(async () => { resolve({ plan, progress: [progress], nextDayId: 'day-1' }); });
  expect(result.current.plan?.id).toBe('plan-B');
  reading.mockRestore();
});
it('keeps the loading path when neither cache nor network plan is available yet', async () => {
  mockGetPlan.mockReturnValue(new Promise(() => {}));
  const { result } = renderHook(() => useDashboard('A', 70));
  await waitFor(() => expect(mockGetPlan).toHaveBeenCalledWith('A'));
  expect(result.current.loading).toBe(true);
  expect(result.current.plan).toBeNull();
  expect(result.current.usingCachedPlan).toBe(false);
});

it('keeps confirmed progression and rotation when an older dashboard refresh finishes later', async () => {
  await planCache.write('A', plan, [progress], 'day-1');
  let resolve!: (value: number | null) => void;
  mockLastIndex.mockReturnValue(new Promise((done) => { resolve = done; }));
  const { result } = renderHook(() => useDashboard('A', 70));
  await waitFor(() => expect(mockLastIndex).toHaveBeenCalled());
  const confirmed = [{ ...progress, last_weight_kg: 55 }];
  await planCache.advanceAfterSession('A', 'day-1', confirmed);
  await act(async () => { resolve(0); });
  await waitFor(() => expect(result.current.lastLoadKg.get('press')).toBe(55));
  expect(result.current.nextDay?.id).toBe('day-0');
  expect(result.current.usingCachedPlan).toBe(true);
  expect((await planCache.read('A'))?.progress).toEqual(confirmed);
});
