import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { installAuthCrypto } from '@/lib/auth-crypto';

jest.mock('expo-crypto', () => ({
  getRandomValues: (values: Uint32Array) => values.fill(17),
  digest: async (algorithm: string, data: ArrayBuffer) => {
    const digest = require('node:crypto').createHash(algorithm.replace('-', '').toLowerCase()).update(Buffer.from(data)).digest();
    return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
  },
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

it('provides secure randomness and SHA-256 for native Supabase PKCE', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  Platform.OS = 'ios';
  try {
    installAuthCrypto();
    expect(crypto.getRandomValues(new Uint32Array(2))).toEqual(new Uint32Array([17, 17]));
    const bytes = new TextEncoder().encode('PKCE');
    const result = await crypto.subtle.digest('SHA-256', bytes);
    expect(Buffer.from(result).toString('hex')).toBe(createHash('sha256').update('PKCE').digest('hex'));
    await expect(crypto.subtle.digest('SHA-1', bytes)).rejects.toThrow(/unsupported/i);

    const storage = new Map<string, string>();
    const client = createClient('https://test.supabase.co', 'publishable-test-key', {
      auth: {
        flowType: 'pkce', detectSessionInUrl: false, autoRefreshToken: false,
        storage: {
          getItem: (key) => storage.get(key) ?? null,
          setItem: (key, value) => { storage.set(key, value); },
          removeItem: (key) => { storage.delete(key); },
        },
      },
    });
    const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: { skipBrowserRedirect: true } });
    expect(error).toBeNull();
    const authorize = new URL(data.url!);
    const storedVerifier = storage.get('sb-test-auth-token-code-verifier');
    const verifier = storedVerifier ? JSON.parse(storedVerifier) as string : null;
    expect(verifier).toBeTruthy();
    expect(authorize.searchParams.get('code_challenge_method')).toBe('s256');
    expect(authorize.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier!).digest('base64url'));
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else Reflect.deleteProperty(globalThis, 'crypto');
  }
});
