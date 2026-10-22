import * as ExpoCrypto from 'expo-crypto';
import { Platform } from 'react-native';

/** Supply the native WebCrypto operations Supabase needs for secure PKCE. */
export function ensureAuthCrypto(): void {
  // ExpoCrypto.web delegates to WebCrypto, so installing it there would recurse.
  if (Platform.OS === 'web') return;
  const crypto = globalThis.crypto ?? {} as Crypto;
  if (typeof crypto.getRandomValues !== 'function') {
    Object.defineProperty(crypto, 'getRandomValues', {
      configurable: true,
      value: ExpoCrypto.getRandomValues,
    });
  }
  const subtle = crypto.subtle ?? {} as SubtleCrypto;
  if (typeof subtle.digest !== 'function') {
    Object.defineProperty(subtle, 'digest', {
      configurable: true,
      value: (algorithm: AlgorithmIdentifier, data: BufferSource) => {
        const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
        if (name.toUpperCase() !== 'SHA-256') return Promise.reject(new Error('Unsupported authentication digest.'));
        return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, data);
      },
    });
  }
  if (!crypto.subtle) Object.defineProperty(crypto, 'subtle', { configurable: true, value: subtle });
  if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { configurable: true, value: crypto });
}
