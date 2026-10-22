import { supabase } from '@/lib/db/supabase';
import { startSessionOnce } from '@/lib/db/workout-lifecycle';

jest.mock('@/lib/db/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const id = '11111111-1111-4111-8111-111111111111';
const start = {
  sessionId: id,
  planDayId: '22222222-2222-4222-8222-222222222222',
  startedAt: '2026-10-22T10:00:00.000Z',
  localDay: '2026-10-22',
  tz: 'America/Los_Angeles',
};
const respond = (data: unknown, error: unknown = null) => {
  const request = Object.assign(Promise.resolve({ data, error }), {
    abortSignal: jest.fn(() => Promise.resolve({ data, error })),
  });
  jest.mocked(supabase.rpc).mockReturnValue(request as never);
  return request;
};

beforeEach(() => jest.clearAllMocks());

it('reuses the captured session identity and time context through the owning client', async () => {
  const request = respond(id);
  const client = { rpc: jest.fn(() => request) };
  const signal = new AbortController().signal;
  await expect(startSessionOnce(start, client as unknown as typeof supabase, signal)).resolves.toBe(id);
  expect(client.rpc).toHaveBeenCalledWith('start_session', {
    p_session_id: id, p_plan_day_id: start.planDayId, p_started_at: start.startedAt,
    p_local_day: start.localDay, p_tz: start.tz,
  });
  expect(request.abortSignal).toHaveBeenCalledWith(signal);
  expect(supabase.rpc).not.toHaveBeenCalled();
});

it('passes a retry conflict to the queue without acknowledging the session', async () => {
  respond(null, { code: 'PT409', message: 'Session identity changed.' });
  await expect(startSessionOnce(start)).rejects.toEqual({ code: 'PT409', message: 'Session identity changed.' });
});

it.each([null, {}, 'bad', '33333333-3333-4333-8333-333333333333'])('rejects an invalid or mismatched acknowledgement: %p', async data => {
  respond(data);
  await expect(startSessionOnce(start)).rejects.toThrow('Invalid workout start response');
});

it('accepts the same UUID regardless of letter case', async () => {
  const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  respond(sessionId.toUpperCase());
  await expect(startSessionOnce({ ...start, sessionId })).resolves.toBe(sessionId);
});
