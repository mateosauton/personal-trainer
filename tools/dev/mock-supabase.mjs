/**
 * A tiny stand-in for the Supabase endpoints this app actually calls.
 *
 * The real project host is blocked by this container's egress policy, so the
 * UI is exercised against this instead: same wire shapes (GoTrue + the slice of
 * PostgREST in lib/db/queries.ts), in-memory state, no network.
 *
 *   node mock-supabase.mjs [port]        # default 54321
 *
 * Query params it understands: ?state=fresh (no profile/plan -> onboarding),
 * ?state=onboarded (default: profile + generated plan + some history).
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.argv[2] ?? 54321);

// ------------------------------------------------------------------ store --

const db = {
  users: new Map(), // email -> { id, email, password }
  profiles: new Map(), // id -> row
  plans: [],
  plan_days: [],
  plan_blocks: [],
  plan_items: [],
  sessions: [],
  set_logs: [],
  exercise_progress: [],
};

const tokens = new Map(); // access_token -> userId
/** Storage stand-in: "<bucket>/<path>" -> { body, contentType }. */
const objects = new Map();

/** Artificial round-trip delay, set through GET /__slow?ms=600. */
let latencyMs = 0;
const settle = () => (latencyMs ? new Promise((r) => setTimeout(r, latencyMs)) : null);

const SEED_USER = { id: '11111111-1111-4111-8111-111111111111', email: 'demo@officegym.test', password: 'demo1234' };
const FRESH_USER = { id: '22222222-2222-4222-8222-222222222222', email: 'fresh@officegym.test', password: 'demo1234' };

function resetSeed() {
  db.users.clear();
  db.profiles.clear();
  db.plans = [];
  db.plan_days = [];
  db.plan_blocks = [];
  db.plan_items = [];
  db.sessions = [];
  db.set_logs = [];
  db.exercise_progress = [];

  db.users.set(SEED_USER.email, SEED_USER);
  db.users.set(FRESH_USER.email, FRESH_USER);

  // A fresh signup: profile row exists (trigger), nothing filled in.
  db.profiles.set(FRESH_USER.id, blankProfile(FRESH_USER.id));

  // The onboarded account, with a plan already built.
  db.profiles.set(SEED_USER.id, {
    ...blankProfile(SEED_USER.id),
    display_name: 'Mateo',
    units: 'kg',
    bodyweight_kg: 78,
    goal: 'hypertrophy',
    experience: 'intermediate',
    days_per_week: 4,
    session_minutes: 45,
    equipment: ['barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'bands', 'bodyweight'],
    limitations: [],
    onboarded_at: '2026-08-20T10:00:00.000Z',
  });
  seedPlan(SEED_USER.id);
  db.exercise_progress.push({
    user_id: SEED_USER.id,
    exercise_id: 'one-arm-kettlebell-row',
    last_weight_kg: 20,
    last_reps: 12,
    best_weight_kg: 20,
    best_e1rm: 28,
    miss_streak: 0,
  });
}

function blankProfile(id) {
  return {
    id,
    display_name: null,
    units: 'kg',
    bodyweight_kg: null,
    goal: null,
    experience: null,
    days_per_week: null,
    session_minutes: null,
    equipment: [],
    limitations: [],
    onboarded_at: null,
    height_cm: null,
    avatar_url: null,
  };
}

/** One realistic day, mirroring what lib/plan/generate.ts produces. */
function seedPlan(userId) {
  const planId = randomUUID();
  db.plans.push({ id: planId, user_id: userId, name: 'Upper / Lower', split: 'Upper / Lower', weeks: 4, is_active: true });

  const days = [
    { name: 'Upper A', focus: 'Horizontal' },
    { name: 'Lower A', focus: 'Squat' },
    { name: 'Upper B', focus: 'Vertical' },
    { name: 'Lower B', focus: 'Hinge' },
  ];
  days.forEach((d, dayIndex) => {
    const dayId = randomUUID();
    db.plan_days.push({ id: dayId, plan_id: planId, day_index: dayIndex, name: d.name, focus: d.focus });

    const blocks = [
      { kind: 'warmup', title: 'Warm-up', rounds: 1, rest_seconds: 0, items: [
        { exercise_id: 'mountain-climbers', sets: 1, reps_low: 0, reps_high: 0, seconds: 40 },
      ] },
      { kind: 'straight', title: 'Block 1 · Primary', rounds: 1, rest_seconds: 105, items: [
        { exercise_id: 'front-squat', sets: 4, reps_low: 6, reps_high: 10, seconds: null },
      ] },
      { kind: 'straight', title: 'Block 2 · Secondary', rounds: 1, rest_seconds: 105, items: [
        { exercise_id: 'one-arm-kettlebell-row', sets: 3, reps_low: 8, reps_high: 12, seconds: null, notes: 'Per side' },
      ] },
      { kind: 'superset', title: 'Block 3 · Superset', rounds: 3, rest_seconds: 60, items: [
        { exercise_id: 'side-lying-lateral-raise', sets: 3, reps_low: 10, reps_high: 15, seconds: null },
        { exercise_id: 'reverse-grip-lat-pulldown', sets: 3, reps_low: 10, reps_high: 15, seconds: null },
      ] },
      { kind: 'circuit', title: 'Block 4 · Finisher', rounds: 2, rest_seconds: 40, items: [
        { exercise_id: 'stability-ball-knee-tuck', sets: 2, reps_low: 12, reps_high: 20, seconds: null },
      ] },
    ];

    blocks.forEach((b, blockIndex) => {
      const blockId = randomUUID();
      db.plan_blocks.push({
        id: blockId, plan_day_id: dayId, block_index: blockIndex,
        kind: b.kind, title: b.title, rounds: b.rounds, rest_seconds: b.rest_seconds,
      });
      b.items.forEach((it, itemIndex) => {
        db.plan_items.push({
          id: randomUUID(), block_id: blockId, item_index: itemIndex,
          exercise_id: it.exercise_id, sets: it.sets, reps_low: it.reps_low,
          reps_high: it.reps_high, seconds: it.seconds ?? null, tempo: null,
          notes: it.notes ?? null,
        });
      });
    });
  });
}

resetSeed();

// ------------------------------------------------------------------ utils --

const json = (res, status, body, headers = {}) => {
  const payload = body === null ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-expose-headers': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    ...headers,
  });
  res.end(payload);
};

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        resolve(null);
      }
    });
  });

/** `id=eq.<v>` / `user_id=eq.<v>` / `is_active=eq.true` -> predicate. */
function matcher(url) {
  const filters = [];
  for (const [key, value] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'state'].includes(key)) continue;
    const [op, ...rest] = value.split('.');
    const operand = rest.join('.');
    filters.push({ key, op, operand });
  }
  return (row) =>
    filters.every(({ key, op, operand }) => {
      const actual = key.split('.').reduce((value, part) => value?.[part], row);
      if (op === 'eq') return String(actual) === operand || String(actual) === String(operand === 'true' ? true : operand);
      if (op === 'neq') return String(actual) !== operand;
      if (op === 'in') return operand.slice(1, -1).split(',').map((value) => value.replace(/^"|"$/g, '')).includes(String(actual));
      if (op === 'not') return operand === 'is.null' ? actual != null : true;
      if (op === 'is') return operand === 'null' ? actual == null : actual === (operand === 'true');
      return true;
    });
}

/** PostgREST order fields are compared in order before applying the range. */
function orderedPage(rows, url) {
  const order = url.searchParams.get('order');
  if (order) {
    rows.sort((a, b) => {
      for (const clause of order.split(',')) {
        const [field, direction] = clause.split('.');
        const comparison = String(a[field] ?? '').localeCompare(String(b[field] ?? ''));
        if (comparison) return comparison * (direction === 'desc' ? -1 : 1);
      }
      return 0;
    });
  }
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const limit = url.searchParams.get('limit');
  return rows.slice(offset, limit === null ? undefined : offset + Number(limit));
}

const wantsObject = (req) => (req.headers.accept ?? '').includes('pgrst.object');
const wantsRepresentation = (req) => (req.headers.prefer ?? '').includes('return=representation');

function userFor(req) {
  const auth = req.headers.authorization ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  return tokens.get(token) ?? null;
}

function makeSession(user) {
  const access = `mock-access-${randomUUID()}`;
  tokens.set(access, user.id);
  return {
    access_token: access,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `mock-refresh-${randomUUID()}`,
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      email_confirmed_at: new Date().toISOString(),
      phone: '',
      confirmed_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_anonymous: false,
    },
  };
}

// ------------------------------------------------------------------ routes --

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') return json(res, 204, null);

  // Test hooks -----------------------------------------------------------
  if (path === '/__reset') {
    resetSeed();
    return json(res, 200, { ok: true });
  }
  if (path === '/__slow') {
    // Writes here are instant, which hides anything the app shows while it is
    // waiting. This dials in the latency a real database would have.
    latencyMs = Number(url.searchParams.get('ms') ?? 0) || 0;
    return json(res, 200, { latencyMs });
  }
  if (path === '/__state') {
    return json(res, 200, {
      profiles: [...db.profiles.values()],
      sessions: db.sessions,
      set_logs: db.set_logs,
      plans: db.plans.length,
      active_plans: db.plans.filter((plan) => plan.is_active),
      plan_days: db.plan_days,
      plan_blocks: db.plan_blocks,
      plan_items: db.plan_items,
    });
  }

  // GoTrue ---------------------------------------------------------------
  if (path === '/auth/v1/token') {
    const body = await readBody(req);
    const user = db.users.get(String(body?.email ?? '').toLowerCase());
    if (!user || user.password !== body?.password) {
      return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
    }
    return json(res, 200, makeSession(user));
  }

  if (path === '/auth/v1/signup') {
    const body = await readBody(req);
    const email = String(body?.email ?? '').toLowerCase();
    if (db.users.has(email)) {
      return json(res, 400, { code: 400, msg: 'User already registered', error_code: 'user_already_exists' });
    }
    const user = { id: randomUUID(), email, password: body?.password };
    db.users.set(email, user);
    db.profiles.set(user.id, blankProfile(user.id)); // the on_auth_user_created trigger
    return json(res, 200, makeSession(user));
  }

  if (path === '/auth/v1/logout') return json(res, 204, null);

  if (path === '/auth/v1/user') {
    const userId = userFor(req);
    if (!userId) return json(res, 401, { message: 'Unauthorized' });
    const email = [...db.users.values()].find((u) => u.id === userId)?.email;
    return json(res, 200, { id: userId, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} });
  }

  if (path.startsWith('/storage/v1/') || path.startsWith('/rest/v1/')) await settle();

  // Storage --------------------------------------------------------------
  if (path.startsWith('/storage/v1/object/')) {
    const publicPrefix = '/storage/v1/object/public/';
    if (req.method === 'GET' && path.startsWith(publicPrefix)) {
      const object = objects.get(path.slice(publicPrefix.length));
      if (!object) return json(res, 404, { message: 'Not found' });
      res.writeHead(200, {
        'content-type': object.contentType,
        'access-control-allow-origin': '*',
      });
      return res.end(object.body);
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const key = path.slice('/storage/v1/object/'.length);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      objects.set(key, {
        body: Buffer.concat(chunks),
        contentType: req.headers['content-type'] ?? 'application/octet-stream',
      });
      return json(res, 200, { Key: key, Id: randomUUID() });
    }
  }

  // PostgREST ------------------------------------------------------------
  if (path.startsWith('/rest/v1/')) {
    const table = path.slice('/rest/v1/'.length);
    const userId = userFor(req);
    const body = await readBody(req);
    const where = matcher(url);

    if (table === 'rpc/save_plan' && req.method === 'POST') {
      if (!userId) return json(res, 401, { message: 'Not authenticated' });
      const plan = body?.plan;
      if (!plan || typeof plan.name !== 'string' || typeof plan.split !== 'string'
        || !Array.isArray(plan.days) || plan.days.length < 1 || plan.days.length > 7) {
        return json(res, 400, { message: 'A plan must have between 1 and 7 days' });
      }
      // Stage all nested rows before retiring the previous plan, mirroring the
      // atomic production RPC rather than masking it with a successful [].
      const planId = randomUUID();
      const days = [];
      const blocks = [];
      const items = [];
      try {
        plan.days.forEach((day, dayIndex) => {
          if (!Array.isArray(day.blocks)) throw new Error('Missing blocks');
          const dayId = randomUUID();
          days.push({ id: dayId, plan_id: planId, day_index: dayIndex, name: day.name, focus: day.focus });
          day.blocks.forEach((block, blockIndex) => {
            if (!['warmup', 'straight', 'superset', 'circuit'].includes(block.kind)
              || !Array.isArray(block.items)) throw new Error('Invalid block');
            const blockId = randomUUID();
            blocks.push({
              id: blockId, plan_day_id: dayId, block_index: blockIndex,
              kind: block.kind, title: block.title, rounds: block.rounds,
              rest_seconds: block.rest_seconds,
            });
            block.items.forEach((item, itemIndex) => {
              if (typeof item.exercise_id !== 'string' || !Number.isInteger(item.sets)
                || !Number.isInteger(item.reps_low) || !Number.isInteger(item.reps_high)) {
                throw new Error('Invalid exercise prescription');
              }
              items.push({
                id: randomUUID(), block_id: blockId, item_index: itemIndex,
                exercise_id: item.exercise_id, sets: item.sets,
                reps_low: item.reps_low, reps_high: item.reps_high,
                seconds: item.seconds ?? null, tempo: item.tempo ?? null, notes: item.notes ?? null,
              });
            });
          });
        });
      } catch (error) {
        return json(res, 400, { message: error.message });
      }
      db.plans.forEach((existing) => {
        if (existing.user_id === userId) existing.is_active = false;
      });
      db.plans.push({ id: planId, user_id: userId, name: plan.name, split: plan.split, weeks: plan.weeks ?? 4, is_active: true });
      db.plan_days.push(...days);
      db.plan_blocks.push(...blocks);
      db.plan_items.push(...items);
      return json(res, 200, planId);
    }

    if (table === 'profiles') {
      if (req.method === 'GET') {
        const rows = [...db.profiles.values()].filter(where);
        return json(res, 200, wantsObject(req) ? (rows[0] ?? null) : rows);
      }
      if (req.method === 'PATCH') {
        for (const [id, row] of db.profiles) {
          if (where(row)) db.profiles.set(id, { ...row, ...body });
        }
        return wantsRepresentation(req)
          ? json(res, 200, [...db.profiles.values()].filter(where))
          : json(res, 204, null);
      }
    }

    if (table === 'plans') {
      if (req.method === 'GET') {
        const plans = db.plans.filter(where);
        const shaped = plans.map((plan) => ({
          id: plan.id,
          name: plan.name,
          split: plan.split,
          weeks: plan.weeks,
          plan_days: db.plan_days
            .filter((d) => d.plan_id === plan.id)
            .map((d) => ({
              id: d.id,
              day_index: d.day_index,
              name: d.name,
              focus: d.focus,
              plan_blocks: db.plan_blocks
                .filter((b) => b.plan_day_id === d.id)
                .map((b) => ({
                  id: b.id,
                  block_index: b.block_index,
                  kind: b.kind,
                  title: b.title,
                  rounds: b.rounds,
                  rest_seconds: b.rest_seconds,
                  plan_items: db.plan_items.filter((i) => i.block_id === b.id),
                })),
            })),
        }));
        return json(res, 200, wantsObject(req) ? (shaped[0] ?? null) : shaped);
      }
      if (req.method === 'PATCH') {
        db.plans.forEach((p) => {
          if (where(p)) Object.assign(p, body);
        });
        return json(res, 204, null);
      }
      if (req.method === 'POST') {
        const row = { id: randomUUID(), is_active: true, ...body };
        db.plans.push(row);
        return json(res, 201, wantsObject(req) ? row : [row]);
      }
    }

    const plain = {
      plan_days: db.plan_days,
      plan_blocks: db.plan_blocks,
      plan_items: db.plan_items,
      set_logs: db.set_logs,
      exercise_progress: db.exercise_progress,
    };

    if (table in plain) {
      const rows = plain[table];
      if (req.method === 'GET') {
        const select = url.searchParams.get('select') ?? '';
        const visible = table === 'set_logs' ? rows
          .filter((row) => db.sessions.some((session) => session.id === row.session_id && session.user_id === userId))
          .map((row) => {
            const shaped = { ...row };
            if (select.includes('sessions')) {
              const session = db.sessions.find((candidate) => candidate.id === row.session_id);
              shaped.sessions = { user_id: session.user_id, completed_at: session.completed_at };
            }
            if (select.includes('plan_items')) {
              const item = db.plan_items.find((candidate) => candidate.id === row.plan_item_id);
              const block = item && db.plan_blocks.find((candidate) => candidate.id === item.block_id);
              shaped.plan_items = item ? { plan_blocks: block ? { kind: block.kind } : null } : null;
            }
            return shaped;
          }) : rows;
        const found = orderedPage(visible.filter((r) => where(r) && (!('user_id' in r) || r.user_id === userId || !userId)), url);
        return json(res, 200, wantsObject(req) ? (found[0] ?? null) : found);
      }
      if (req.method === 'POST') {
        const incoming = (Array.isArray(body) ? body : [body]).map((r) => ({
          id: randomUUID(),
          ...(table === 'set_logs' ? {
            completed_at: new Date().toISOString(), weight_kg: null, added_load_kg: 0, is_bodyweight: false,
          } : {}),
          ...r,
        }));
        const onConflict = url.searchParams.get('on_conflict');
        for (const row of incoming) {
          if (onConflict) {
            const keys = onConflict.split(',');
            const existing = rows.find((r) => keys.every((k) => String(r[k]) === String(row[k])));
            if (existing) {
              Object.assign(existing, row);
              continue;
            }
          }
          rows.push(row);
        }
        return json(res, 201, wantsObject(req) ? incoming[0] : incoming);
      }
    }

    if (table === 'sessions') {
      if (req.method === 'GET') {
        let found = db.sessions
          .filter((s) => s.user_id === userId)
          .map((s) => ({
            ...s,
            plan_days: (() => {
              const d = db.plan_days.find((x) => x.id === s.plan_day_id);
              return d ? { name: d.name, focus: d.focus, day_index: d.day_index, plan_id: d.plan_id } : null;
            })(),
          }))
          .filter(where);
        found = orderedPage(found, url);
        return json(res, 200, wantsObject(req) ? (found[0] ?? null) : found);
      }
      if (req.method === 'POST') {
        const row = { id: randomUUID(), started_at: new Date().toISOString(), completed_at: null, ...body };
        db.sessions.push(row);
        return json(res, 201, wantsObject(req) ? row : [row]);
      }
      if (req.method === 'PATCH') {
        db.sessions.forEach((s) => {
          if (where(s)) Object.assign(s, body);
        });
        return json(res, 204, null);
      }
    }

    return json(res, 200, []);
  }

  json(res, 404, { message: 'Not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock supabase on http://127.0.0.1:${PORT}`);
  console.log(`  onboarded: ${SEED_USER.email} / ${SEED_USER.password}`);
  console.log(`  fresh:     ${FRESH_USER.email} / ${FRESH_USER.password}`);
});
