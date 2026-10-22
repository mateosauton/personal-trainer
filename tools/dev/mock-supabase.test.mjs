import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

let child;
let base;
let token;

before(async () => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  child = spawn(process.execPath, [fileURLToPath(new URL('./mock-supabase.mjs', import.meta.url)), String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = `http://127.0.0.1:${port}`;
  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(() => { throw new Error('Mock server failed to start'); }),
  ]);
});

after(() => child?.kill());

async function request(path, { method = 'GET', body, authenticated = true, object = false } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
      ...(object ? { accept: 'application/vnd.pgrst.object+json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: response.status === 204 ? null : await response.json() };
}

beforeEach(async () => {
  await request('/__reset');
  const result = await request('/auth/v1/token', {
    method: 'POST', authenticated: false,
    body: { email: 'demo@officegym.test', password: 'demo1234' },
  });
  token = result.data.access_token;
});

const routine = () => ({
  name: 'Gym PPL · 47 min', split: 'Gym PPL · 6-session rotation', weeks: 6,
  days: ['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B'].map((name) => ({
    name, focus: name.split(' ')[0],
    blocks: [{
      kind: 'straight', title: 'Strength', rounds: 1, rest_seconds: 90,
      items: [{ exercise_id: 'Barbell_Bench_Press_-_Medium_Grip', sets: 2, reps_low: 4, reps_high: 6, seconds: null, tempo: null, notes: null }],
    }],
  })),
});

test('save_plan persists nested days and retires the previous plan atomically', async () => {
  const result = await request('/rest/v1/rpc/save_plan', { method: 'POST', body: { plan: routine() } });
  assert.equal(result.status, 200);
  assert.equal(typeof result.data, 'string');
  const active = await request('/rest/v1/plans?is_active=eq.true', { object: true });
  assert.equal(active.data.id, result.data);
  assert.deepEqual(active.data.plan_days.map((day) => day.name), routine().days.map((day) => day.name));
  assert.equal(active.data.plan_days[0].plan_blocks[0].plan_items[0].sets, 2);

  const failed = await request('/rest/v1/rpc/save_plan', { method: 'POST', body: { plan: { ...routine(), days: [] } } });
  assert.equal(failed.status, 400);
  const unchanged = await request('/rest/v1/plans?is_active=eq.true', { object: true });
  assert.equal(unchanged.data.id, result.data);
});

test('save_plan requires an authenticated user', async () => {
  const result = await request('/rest/v1/rpc/save_plan', { method: 'POST', body: { plan: routine() }, authenticated: false });
  assert.equal(result.status, 401);
});

test('the completed-day join returns the latest index in the requested rotation', async () => {
  await request('/rest/v1/rpc/save_plan', { method: 'POST', body: { plan: routine() } });
  const active = await request('/rest/v1/plans?is_active=eq.true', { object: true });
  assert.equal(active.data.plan_days.length, 6);
  const day = active.data.plan_days[5];
  const started = await request('/rest/v1/sessions', { method: 'POST', object: true, body: {
    user_id: '11111111-1111-4111-8111-111111111111', plan_day_id: day.id,
  } });
  await request(`/rest/v1/sessions?id=eq.${started.data.id}`, { method: 'PATCH', body: { completed_at: new Date().toISOString(), duration_s: 2820 } });
  const last = await request(`/rest/v1/sessions?select=plan_days!inner(day_index,plan_id)&plan_days.plan_id=eq.${active.data.id}&completed_at=not.is.null&order=completed_at.desc&limit=1`, { object: true });
  assert.equal(last.data.plan_days.day_index, 5);
  assert.equal(last.data.plan_days.plan_id, active.data.id);
});

test('weight history joins completed owned sessions, filters exact exercises, and paginates in a stable order', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const active = await request('/rest/v1/plans?is_active=eq.true', { object: true });
  const day = active.data.plan_days[0];
  const workingItem = day.plan_blocks.find((block) => block.kind === 'straight').plan_items[0];
  const warmupItem = day.plan_blocks.find((block) => block.kind === 'warmup').plan_items[0];
  const start = async (patch = {}) => (await request('/rest/v1/sessions', {
    method: 'POST', object: true,
    body: { user_id: userId, plan_day_id: day.id, ...patch },
  })).data.id;
  const complete = async (id) => request(`/rest/v1/sessions?id=eq.${id}`, {
    method: 'PATCH', body: { completed_at: '2026-10-21T10:00:00Z' },
  });
  const completedId = await start();
  const currentId = await start();
  const unfinishedId = await start();
  const foreignId = await start({ user_id: '22222222-2222-4222-8222-222222222222' });
  await complete(completedId);
  await complete(currentId);
  await complete(foreignId);
  const log = (id, sessionId, patch = {}) => ({
    id, session_id: sessionId, plan_item_id: workingItem.id,
    exercise_id: workingItem.exercise_id, set_index: 0,
    weight_kg: 40, reps: 8, is_bodyweight: false, added_load_kg: 0,
    completed_at: '2026-10-21T09:00:00Z', ...patch,
  });
  await request('/rest/v1/set_logs', { method: 'POST', body: [
    log('log-a', completedId),
    log('log-c', completedId),
    log('log-b', completedId, { plan_item_id: null }),
    log('log-warmup', completedId, { plan_item_id: warmupItem.id, completed_at: '2026-10-21T08:00:00Z' }),
    log('log-other-exercise', completedId, { exercise_id: 'unrequested-exercise' }),
    log('log-current', currentId),
    log('log-unfinished', unfinishedId),
    log('log-foreign', foreignId),
  ] });
  const query = new URLSearchParams({
    select: 'id,exercise_id,session_id,weight_kg,added_load_kg,is_bodyweight,reps,completed_at,sessions!inner(user_id,completed_at),plan_items(plan_blocks(kind))',
    'sessions.user_id': `eq.${userId}`,
    'sessions.completed_at': 'not.is.null',
    exercise_id: `in.(${workingItem.exercise_id})`,
    session_id: `neq.${currentId}`,
    order: 'completed_at.desc,id.desc',
    offset: '1', limit: '2',
  });

  const history = await request(`/rest/v1/set_logs?${query}`);

  assert.equal(history.status, 200);
  assert.deepEqual(history.data.map((row) => row.id), ['log-b', 'log-a']);
  assert.deepEqual(history.data[0].sessions, { user_id: userId, completed_at: '2026-10-21T10:00:00Z' });
  assert.equal(history.data[0].plan_items, null);
  assert.deepEqual(history.data[1].plan_items, { plan_blocks: { kind: 'straight' } });

  query.set('offset', '3');
  const warmupPage = await request(`/rest/v1/set_logs?${query}`);
  assert.deepEqual(warmupPage.data.map((row) => row.id), ['log-warmup']);
  assert.deepEqual(warmupPage.data[0].plan_items, { plan_blocks: { kind: 'warmup' } });

  query.delete('sessions.user_id');
  query.delete('sessions.completed_at');
  query.delete('session_id');
  query.delete('offset');
  query.delete('limit');
  const ownerScoped = await request(`/rest/v1/set_logs?${query}`);
  assert.ok(ownerScoped.data.every((row) => row.sessions.user_id === userId));
  assert.equal(ownerScoped.data.some((row) => row.id === 'log-foreign'), false);
});

test('newly recorded sets receive the production timestamp and bodyweight defaults', async () => {
  const session = await request('/rest/v1/sessions', { method: 'POST', object: true, body: {
    user_id: '11111111-1111-4111-8111-111111111111', plan_day_id: null,
  } });
  const saved = await request('/rest/v1/set_logs', { method: 'POST', object: true, body: {
    session_id: session.data.id, exercise_id: 'pull-up', plan_item_id: null, set_index: 0,
    is_bodyweight: true, reps: 8,
  } });
  assert.ok(Number.isFinite(Date.parse(saved.data.completed_at)));
  assert.equal(saved.data.added_load_kg, 0);
  assert.equal(saved.data.weight_kg, null);
});
