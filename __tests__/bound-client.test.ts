jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(), removeItem: jest.fn(),
}));

it('keeps a queued write bound to the captured access token', async () => {
  const previous = { url: process.env.EXPO_PUBLIC_SUPABASE_URL, key: process.env.EXPO_PUBLIC_SUPABASE_KEY };
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_KEY = 'test-publishable-key';
  const previousFetch = global.fetch;
  const fetch = jest.fn().mockResolvedValue({ ok: true, status: 201, statusText: 'Created', text: async () => '[]', headers: { get: () => null } });
  global.fetch = fetch;
  try {
    const { clientForAccessToken } = require('@/lib/db/supabase');
    const client = clientForAccessToken('captured-token-A');
    const { error } = await client.from('set_logs').insert({ session_id: 'session-A' });
    expect(error).toBeNull();
    const headers = fetch.mock.calls[0][1].headers;
    expect(headers.get('Authorization')).toBe('Bearer captured-token-A');
  } finally {
    global.fetch = previousFetch;
    if (previous.url === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_KEY;
    else process.env.EXPO_PUBLIC_SUPABASE_KEY = previous.key;
  }
});

it('cancels an actual database request when sync expires', async () => {
  const previous = { url: process.env.EXPO_PUBLIC_SUPABASE_URL, key: process.env.EXPO_PUBLIC_SUPABASE_KEY };
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_KEY = 'test-publishable-key';
  const previousFetch = global.fetch;
  const controller = new AbortController();
  const fetch = jest.fn((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('Request aborted')), { once: true });
  }));
  global.fetch = fetch as typeof global.fetch;
  try {
    const { clientForAccessToken } = require('@/lib/db/supabase');
    const { logSet } = require('@/lib/db/queries');
    const write = logSet('session-A', { plan_item_id: 'item-A', set_index: 1 },
      clientForAccessToken('captured-token-A'), controller.signal);
    while (fetch.mock.calls.length === 0) await Promise.resolve();
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
    controller.abort();
    await expect(write).rejects.toMatchObject({ message: expect.stringContaining('Request aborted') });
  } finally {
    global.fetch = previousFetch;
    if (previous.url === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_KEY;
    else process.env.EXPO_PUBLIC_SUPABASE_KEY = previous.key;
  }
});
