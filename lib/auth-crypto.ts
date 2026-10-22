import { CryptoDigestAlgorithm, digest, getRandomValues } from 'expo-crypto';
import { Platform } from 'react-native';

/** Supabase's PKCE implementation needs these Web Crypto methods on Hermes. */
export function installAuthCrypto() {
  if (Platform.OS === 'web') return;
  if (typeof globalThis.crypto === 'undefined') {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  }
  if (!globalThis.crypto.getRandomValues) {
    Object.defineProperty(globalThis.crypto, 'getRandomValues', { value: getRandomValues });
  }
  if (!globalThis.crypto.subtle) {
    Object.defineProperty(globalThis.crypto, 'subtle', {
      value: {
        digest: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
          const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
          if (name.toUpperCase() !== 'SHA-256') throw new Error('Unsupported auth digest');
          return digest(CryptoDigestAlgorithm.SHA256, data);
        },
      },
    });
  }
}
