import { supabase } from '@/lib/db/supabase';
import {
  checkLegacySet,
  getSetWriteState,
  logSetVersioned,
  getSessionSetSnapshot,
  applySessionProgress,
} from '@/lib/db/queries';
import type { JournalWrite } from '@/lib/session/set-journal';
jest.mock('@/lib/db/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(() => {
      throw new Error('direct write forbidden');
    }),
  },
}));
const write: JournalWrite = {
  id: 'set:fixture',
  ownerId: 'owner',
  sessionId: 'session',
  origin: 'origin',
  revision: 3,
  expectedVersion: 2,
  eventAt: '2026-10-06T10:00:00Z',
  set: {
    plan_item_id: 'item',
    exercise_id: 'press',
    set_index: 1,
    reps: 12,
    weight_kg: 60,
    is_bodyweight: false,
    added_load_kg: 0,
    rpe: null,
  },
};
const respond = (data: unknown, error: unknown = null) => {
  const request = Object.assign(Promise.resolve({ data, error }), {
    abortSignal: jest.fn(() => Promise.resolve({ data, error })),
  });
  jest.mocked(supabase.rpc).mockReturnValue(request as never);
  return request;
};
beforeEach(() => jest.clearAllMocks());
it('uses the captured origin, revision, baseline and original event time through the ordered RPC', async () => {
  const request = respond({ status: 'applied', serverVersion: 4 });
  const signal = new AbortController().signal;
  await expect(logSetVersioned(write, supabase, signal)).resolves.toEqual({
    status: 'applied',
    serverVersion: 4,
  });
  expect(supabase.rpc).toHaveBeenCalledWith('log_set_versioned', {
    p_session_id: 'session',
    p_set: write.set,
    p_origin: 'origin',
    p_revision: 3,
    p_expected_version: 2,
    p_event_at: write.eventAt,
  });
  expect(request.abortSignal).toHaveBeenCalledWith(signal);
  expect(supabase.from).not.toHaveBeenCalled();
});
it('propagates conflict errors without inventing an acknowledgement', async () => {
  respond(null, { code: 'PT409' });
  await expect(logSetVersioned(write)).rejects.toEqual({ code: 'PT409' });
});
it.each([
  { status: 'applied', serverVersion: 0 },
  { status: 'applied', serverVersion: 1.5 },
  { status: 'unexpected', serverVersion: 1 },
  null,
])('rejects malformed acknowledgements: %p', async (result) => {
  respond(result);
  await expect(logSetVersioned(write)).rejects.toThrow(
    'Invalid workout sync response',
  );
});
it('compares a legacy set without sending an origin or revision', async () => {
  respond({ status: 'conflict', serverVersion: 4, set: write.set });
  await expect(checkLegacySet('session', write.set)).resolves.toMatchObject({
    status: 'conflict',
  });
  expect(supabase.rpc).toHaveBeenCalledWith('check_legacy_set', {
    p_session_id: 'session',
    p_set: write.set,
  });
  expect(supabase.from).not.toHaveBeenCalled();
});

it('passes complete captured set versions to the progression guard', async () => {
  const versions = [
    { logId: '11111111-1111-4111-8111-111111111111', serverVersion: 2 },
  ];
  respond([]);
  await applySessionProgress('session', [], [], [], versions);
  expect(supabase.rpc).toHaveBeenCalledWith('apply_session_progress', {
    p_session_id: 'session',
    p_expected: [],
    p_updates: [],
    p_result: [],
    p_set_versions: versions,
  });
});
it('accepts one atomic snapshot with matching log membership', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const snapshot = {
    logs: [{ id }],
    versions: [{ logId: id, serverVersion: 2 }],
  };
  respond(snapshot);
  await expect(getSessionSetSnapshot('session')).resolves.toEqual(snapshot);
  expect(supabase.rpc).toHaveBeenCalledWith('get_session_set_snapshot', {
    p_session_id: 'session',
  });
});
it.each([
  {
    logs: [],
    versions: [
      { logId: '11111111-1111-4111-8111-111111111111', serverVersion: 1 },
    ],
  },
  {
    logs: [{ id: '11111111-1111-4111-8111-111111111111' }],
    versions: [
      { logId: '22222222-1111-4111-8111-222222222222', serverVersion: 1 },
    ],
  },
  {
    logs: [{ id: '11111111-1111-4111-8111-111111111111' }],
    versions: [
      { logId: '11111111-1111-4111-8111-111111111111', serverVersion: 0 },
    ],
  },
  { logs: [{ id: 'bad' }], versions: [{ logId: 'bad', serverVersion: 1 }] },
])(
  'rejects inconsistent snapshot membership or versions: %p',
  async (snapshot) => {
    respond(snapshot);
    await expect(getSessionSetSnapshot('session')).rejects.toThrow('preserved');
  },
);

it('reads a captured server set and baseline with the account-bound client', async () => {
  const state = { serverVersion: 2, origin: null, revision: 0, set: { ...write.set,
    plan_item_id: '11111111-1111-4111-8111-111111111111' }, eventAt: write.eventAt };
  const request = respond(state);
  const signal = new AbortController().signal;
  await expect(getSetWriteState('session', state.set.plan_item_id, 1, supabase, signal)).resolves.toEqual(state);
  expect(supabase.rpc).toHaveBeenCalledWith('get_set_write_state', {
    p_session_id: 'session', p_plan_item_id: state.set.plan_item_id, p_set_index: 1,
  });
  expect(request.abortSignal).toHaveBeenCalledWith(signal);
});
it.each([
  { serverVersion: -1 }, { serverVersion: 1, set: null },
  { serverVersion: 2, set: { ...write.set, plan_item_id: '11111111-1111-4111-8111-111111111111', reps: -2 }, eventAt: write.eventAt },
  { serverVersion: 2, set: { ...write.set, plan_item_id: '11111111-1111-4111-8111-111111111111' }, eventAt: 'bad' },
  { serverVersion: 2, set: { ...write.set, plan_item_id: '22222222-1111-4111-8111-222222222222' }, eventAt: write.eventAt },
])('preserves data when the conflict response is invalid: %p', async (state) => {
  respond(state);
  await expect(getSetWriteState('session', '11111111-1111-4111-8111-111111111111', 1)).rejects.toThrow('Invalid workout recovery response');
});
it('accepts an absent server set without inventing a completion time', async () => {
  respond(null);
  await expect(getSetWriteState('session', 'item', 1)).resolves.toBeNull();
});

it('uses the owning client and deadline signal for a session set snapshot', async () => {
  const snapshot = { logs: [], versions: [] };
  const request = respond(snapshot);
  const client = { rpc: jest.fn(() => request) };
  const signal = new AbortController().signal;
  await expect(getSessionSetSnapshot('session', client as unknown as typeof supabase, signal)).resolves.toEqual(snapshot);
  expect(client.rpc).toHaveBeenCalledWith('get_session_set_snapshot', { p_session_id: 'session' });
  expect(request.abortSignal).toHaveBeenCalledWith(signal);
  expect(supabase.rpc).not.toHaveBeenCalled();
});
