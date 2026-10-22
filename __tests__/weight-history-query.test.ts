const mockHistoryChain = {
  select: jest.fn(),
  eq: jest.fn(),
  not: jest.fn(),
  in: jest.fn(),
  neq: jest.fn(),
  order: jest.fn(),
  range: jest.fn(),
};

jest.mock('@/lib/db/supabase', () => ({
  supabase: { from: jest.fn(() => mockHistoryChain) },
}));

import { getWeightHistory } from '@/lib/db/queries';
import { supabase } from '@/lib/db/supabase';

function loggedSet(patch: Record<string, unknown> = {}) {
  return {
    id: 'log-1',
    exercise_id: 'bench',
    session_id: 'last-session',
    weight_kg: 40,
    added_load_kg: 0,
    is_bodyweight: false,
    reps: 8,
    completed_at: '2026-10-21T09:00:00Z',
    sessions: { user_id: 'user-1', completed_at: '2026-10-21T10:00:00Z' },
    plan_items: { plan_blocks: { kind: 'strength' } },
    ...patch,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const method of ['select', 'eq', 'not', 'in', 'neq', 'order'] as const) {
    mockHistoryChain[method].mockReturnValue(mockHistoryChain);
  }
  mockHistoryChain.range.mockResolvedValue({ data: [], error: null });
});

describe('getWeightHistory', () => {
  it('does not request history when no exercises are supplied', async () => {
    await expect(getWeightHistory('user-1', [])).resolves.toEqual(new Map());
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('explicitly scopes completed history to the user and exact exercises', async () => {
    await getWeightHistory('user-1', ['bench', 'chin-up'], 'current-session');

    expect(supabase.from).toHaveBeenCalledWith('set_logs');
    expect(mockHistoryChain.select).toHaveBeenCalledWith(expect.stringContaining('sessions!inner(user_id, completed_at)'));
    expect(mockHistoryChain.select).toHaveBeenCalledWith(expect.stringContaining('plan_items(plan_blocks(kind))'));
    expect(mockHistoryChain.eq).toHaveBeenCalledWith('sessions.user_id', 'user-1');
    expect(mockHistoryChain.not).toHaveBeenCalledWith('sessions.completed_at', 'is', null);
    expect(mockHistoryChain.in).toHaveBeenCalledWith('exercise_id', ['bench', 'chin-up']);
    expect(mockHistoryChain.neq).toHaveBeenCalledWith('session_id', 'current-session');
    expect(mockHistoryChain.order.mock.calls).toEqual([
      ['completed_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(mockHistoryChain.range).toHaveBeenCalledWith(0, 499);
  });

  it('uses the best working load in the latest session, rather than an older all-time best', async () => {
    mockHistoryChain.range.mockResolvedValue({ data: [
      loggedSet({ id: 'new-low', weight_kg: 42.5, reps: 10, completed_at: '2026-10-21T09:10:00Z' }),
      loggedSet({ id: 'new-high', weight_kg: 45, reps: 7, completed_at: '2026-10-21T09:05:00Z' }),
      loggedSet({ id: 'old-high', session_id: 'old-session', weight_kg: 60, completed_at: '2026-10-18T09:00:00Z' }),
    ], error: null });

    const history = await getWeightHistory('user-1', ['bench']);

    expect(history.get('bench')).toEqual({
      exerciseId: 'bench', sessionId: 'last-session', weightKg: 45, reps: 7,
      completedAt: '2026-10-21T09:05:00Z', isBodyweight: false,
    });
    expect(mockHistoryChain.neq).not.toHaveBeenCalled();
  });

  it('compares bodyweight exercises using added load and preserves zero added load', async () => {
    mockHistoryChain.range.mockResolvedValue({ data: [
      loggedSet({ exercise_id: 'chin-up', is_bodyweight: true, weight_kg: null, added_load_kg: 7.5, reps: 6 }),
      loggedSet({ exercise_id: 'dip', is_bodyweight: true, weight_kg: 75, added_load_kg: 0, reps: 10 }),
    ], error: null });

    const history = await getWeightHistory('user-1', ['chin-up', 'dip']);

    expect(history.get('chin-up')).toMatchObject({ weightKg: 7.5, reps: 6, isBodyweight: true });
    expect(history.get('dip')).toMatchObject({ weightKg: 0, reps: 10, isBodyweight: true });
  });

  it('does not let invalid loads or warmups hide earlier valid sessions', async () => {
    mockHistoryChain.range.mockResolvedValue({ data: [
      ...[null, Number.NaN, Number.POSITIVE_INFINITY, -5].map((weight_kg, index) => loggedSet({
        id: `invalid-${index}`, weight_kg, completed_at: '2026-10-22T09:00:00Z', session_id: 'invalid-session',
      })),
      loggedSet({ id: 'warmup', weight_kg: 90, completed_at: '2026-10-22T09:10:00Z', session_id: 'warmup-session',
        plan_items: { plan_blocks: { kind: 'warmup' } } }),
      loggedSet({ id: 'valid', weight_kg: 45, plan_items: null }),
    ], error: null });

    expect((await getWeightHistory('user-1', ['bench'])).get('bench')).toMatchObject({
      sessionId: 'last-session', weightKg: 45,
    });
  });

  it('excludes an in-progress or other user session even if returned by the transport', async () => {
    mockHistoryChain.range.mockResolvedValue({ data: [
      loggedSet({ session_id: 'current-session', weight_kg: 100 }),
      loggedSet({ sessions: { user_id: 'user-2', completed_at: '2026-10-21T10:00:00Z' }, weight_kg: 200 }),
      loggedSet({ sessions: { user_id: 'user-1', completed_at: null }, weight_kg: 300 }),
      loggedSet({ exercise_id: 'unrequested', weight_kg: 400 }),
      loggedSet({ id: 'valid', weight_kg: 45 }),
    ], error: null });

    const history = await getWeightHistory('user-1', ['bench'], 'current-session');

    expect(history.size).toBe(1);
    expect(history.get('bench')).toMatchObject({ weightKg: 45 });
  });

  it('reads every page so frequently logged exercises do not hide another exercise', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => loggedSet({
      id: `log-${String(500 - index).padStart(4, '0')}`,
    }));
    mockHistoryChain.range
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: [loggedSet({
        id: 'older-row', exercise_id: 'squat', weight_kg: 80,
        completed_at: '2026-10-20T09:00:00Z',
      })], error: null });

    const history = await getWeightHistory('user-1', ['bench', 'squat']);

    expect(history.get('squat')).toMatchObject({ weightKg: 80 });
    expect(mockHistoryChain.range.mock.calls).toEqual([[0, 499], [500, 999]]);
    expect(mockHistoryChain.eq).toHaveBeenCalledTimes(2);
  });

  it('throws query errors instead of presenting missing history as a first workout', async () => {
    const error = new Error('history unavailable');
    mockHistoryChain.range.mockResolvedValue({ data: null, error });

    await expect(getWeightHistory('user-1', ['bench'])).rejects.toThrow('history unavailable');
  });
});
