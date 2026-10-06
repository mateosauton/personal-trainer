import { supabase } from '@/lib/db/supabase';
import { checkLegacySet, logSetVersioned } from '@/lib/db/queries';
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
