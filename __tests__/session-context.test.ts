const mockSingle = jest.fn();
const mockInsert = jest.fn();
const mockRpc = jest.fn();
const mockGetSession = jest.fn();
const mockClientForToken = jest.fn((_token: string) => ({ rpc: mockRpc }));
const mockQuery = { select: jest.fn(), eq: jest.fn(), maybeSingle: mockSingle, single: mockSingle, insert: mockInsert };
mockQuery.select.mockReturnValue(mockQuery);
mockQuery.eq.mockReturnValue(mockQuery);
mockInsert.mockReturnValue(mockQuery);
jest.mock('@/lib/db/supabase', () => ({ supabase: { from: () => mockQuery, auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } }, clientForAccessToken: (token: string) => mockClientForToken(token) }));
jest.mock('@/lib/avatar', () => ({ avatarPath: jest.fn(value => value), resolveAvatar: jest.fn(async value => value), storeAvatar: jest.fn() }));
import { getSessionCalculationContext, startSession } from '@/lib/db/queries';
import type { PlanDay } from '@/lib/types';
const day: PlanDay = { id: 'day', name: 'Day', focus: 'Strength', day_index: 0,
  blocks: [{ id: 'block', block_index: 0, kind: 'straight', title: 'Work', rounds: 1, rest_seconds: 60,
    items: [{ id: 'item', item_index: 0, exercise_id: 'press', sets: 1, reps_low: 8, reps_high: 10, seconds: null, tempo: null, notes: null }] }] };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'owner' }, access_token: 'owner-token' } }, error: null });
  mockRpc.mockResolvedValue({ data: 'new', error: null });
});
it('captures the original context atomically when creating the owned session', async () => {
  await expect(startSession('owner', 'day', { units: 'lb', bodyweightKg: 80 }, day)).resolves.toBe('new');
  expect(mockClientForToken).toHaveBeenCalledWith('owner-token');
  expect(mockRpc).toHaveBeenCalledWith('start_workout', { p_day_id: 'day', p_expected_items: [{ id: 'item', exercise_id: 'press' }], p_context: { units: 'lb', bodyweightKg: 80 } });
});
it('returns historical missing context as unknown rather than reading the current profile', async () => {
  mockSingle.mockResolvedValue({ data: { calculation_units: null, bodyweight_kg: null, calculation_context_captured: false }, error: null });
  expect(await getSessionCalculationContext('session', 'owner')).toBeNull();
  expect(mockQuery.eq).toHaveBeenCalledWith('id', 'session');
  expect(mockQuery.eq).toHaveBeenCalledWith('user_id', 'owner');
});
it('restores captured units and explicitly unknown bodyweight without consulting the profile', async () => {
  mockSingle.mockResolvedValue({ data: { calculation_units: 'kg', bodyweight_kg: null, calculation_context_captured: true }, error: null });
  expect(await getSessionCalculationContext('session', 'owner')).toEqual({ units: 'kg', bodyweightKg: null });
});
it.each([NaN, Infinity, -1, 100001])('rejects invalid captured bodyweight before sending JSON: %p', async bodyweightKg => {
  await expect(startSession('owner', 'day', { units: 'kg', bodyweightKg }, day)).rejects.toThrow('original workout');
  expect(mockRpc).not.toHaveBeenCalled();
});
