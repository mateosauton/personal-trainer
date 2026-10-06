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
