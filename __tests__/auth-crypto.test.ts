import { createHash, randomFillSync } from 'node:crypto';
import { TextEncoder } from 'node:util';

const mockPlatform = { OS: 'ios' };
const mockCreateClient = jest.fn();
const mockRandomValues = jest.fn((array: Uint32Array) => randomFillSync(array));
const mockDigest = jest.fn(async (_algorithm: string, data: ArrayBuffer | ArrayBufferView) => {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const digest = createHash('sha256').update(bytes).digest();
  return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
});
jest.mock('react-native', () => new Proxy(jest.requireActual('react-native'), {
  get: (target, key) => key === 'Platform' ? mockPlatform : Reflect.get(target, key),
}));
jest.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => mockCreateClient(...args) }));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('expo-crypto', () => ({
  getRandomValues: (...args: unknown[]) => mockRandomValues(...args as [Uint32Array]),
  digest: (...args: unknown[]) => mockDigest(...args as [string, ArrayBuffer | ArrayBufferView]),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalEncoder = Object.getOwnPropertyDescriptor(globalThis, 'TextEncoder');
const previousUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const previousKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;
const setCrypto = (value: unknown) => Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value });
const loadClient = () => jest.isolateModules(() => { require('@/lib/db/supabase'); });
beforeEach(() => {
  jest.clearAllMocks();
  mockPlatform.OS = 'ios';
  setCrypto(undefined);
  Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, writable: true, value: TextEncoder });
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://audit.example.invalid';
  process.env.EXPO_PUBLIC_SUPABASE_KEY = 'synthetic-publishable-key';
});
afterEach(() => {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  else Reflect.deleteProperty(globalThis, 'crypto');
  if (originalEncoder) Object.defineProperty(globalThis, 'TextEncoder', originalEncoder);
  else Reflect.deleteProperty(globalThis, 'TextEncoder');
  if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  else process.env.EXPO_PUBLIC_SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_KEY;
  else process.env.EXPO_PUBLIC_SUPABASE_KEY = previousKey;
});

it('installs native secure randomness before the Supabase client is created', () => {
  mockCreateClient.mockImplementationOnce(() => {
    expect(globalThis.crypto?.getRandomValues).toEqual(expect.any(Function));
    expect(globalThis.crypto?.subtle?.digest).toEqual(expect.any(Function));
  });
  loadClient();
});

it('uses native secure randomness and SHA-256 for real SDK PKCE challenges', async () => {
  loadClient();
  expect(globalThis.crypto?.getRandomValues).toEqual(expect.any(Function));
  const { generatePKCEVerifier, generatePKCEChallenge } = jest.requireActual('@supabase/auth-js/dist/main/lib/helpers');
  const weakRandom = jest.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Weak RNG fallback'); });
  let verifier: string;
  try { verifier = generatePKCEVerifier(); }
  finally { weakRandom.mockRestore(); }
  const challenge = await generatePKCEChallenge(verifier!);
  expect(mockRandomValues).toHaveBeenCalledTimes(1);
  expect(mockDigest).toHaveBeenCalledTimes(1);
  expect(challenge).toBe(createHash('sha256').update(verifier!).digest('base64url'));
  expect(challenge).not.toBe(verifier!);
});

it('preserves existing native crypto methods while filling missing digest', () => {
  const getRandomValues = jest.fn();
  const randomUUID = jest.fn();
  const importKey = jest.fn();
  const crypto = { getRandomValues, randomUUID, subtle: { importKey } };
  setCrypto(crypto);
  loadClient();
  expect(globalThis.crypto).toBe(crypto);
  expect(globalThis.crypto.getRandomValues).toBe(getRandomValues);
  expect(globalThis.crypto.randomUUID).toBe(randomUUID);
  expect(globalThis.crypto.subtle.importKey).toBe(importKey);
  expect(globalThis.crypto.subtle.digest).toEqual(expect.any(Function));
});

it.each(['ios', 'web'])('preserves full WebCrypto on %s', (platform) => {
  mockPlatform.OS = platform;
  const crypto = { getRandomValues: jest.fn(), subtle: { digest: jest.fn(), importKey: jest.fn() } };
  setCrypto(crypto);
  loadClient();
  expect(globalThis.crypto).toBe(crypto);
  expect(globalThis.crypto.getRandomValues).toBe(crypto.getRandomValues);
  expect(globalThis.crypto.subtle.digest).toBe(crypto.subtle.digest);
  expect(mockRandomValues).not.toHaveBeenCalled();
  expect(mockDigest).not.toHaveBeenCalled();
});

it('does not install an Expo crypto shim on web', () => {
  mockPlatform.OS = 'web';
  loadClient();
  expect(globalThis.crypto).toBeUndefined();
});

it('fails closed when native entropy generation fails', () => {
  loadClient();
  expect(globalThis.crypto?.getRandomValues).toEqual(expect.any(Function));
  mockRandomValues.mockImplementationOnce(() => { throw new Error('Native entropy unavailable'); });
  const { generatePKCEVerifier } = jest.requireActual('@supabase/auth-js/dist/main/lib/helpers');
  expect(() => generatePKCEVerifier()).toThrow('Native entropy unavailable');
});

it('fails closed when the native SHA-256 digest fails', async () => {
  loadClient();
  expect(globalThis.crypto?.subtle?.digest).toEqual(expect.any(Function));
  mockDigest.mockRejectedValueOnce(new Error('Native digest unavailable'));
  const { generatePKCEChallenge } = jest.requireActual('@supabase/auth-js/dist/main/lib/helpers');
  await expect(generatePKCEChallenge('synthetic-verifier')).rejects.toThrow('Native digest unavailable');
});
