/**
 * Only the pure logic under lib/ is unit-tested here (plan generation,
 * progression, media resolution). Component rendering is verified on a real
 * device via Expo Go, which is faster to trust than a mocked native runtime.
 *
 * These tests never touch React Native, so they compile with plain Babel
 * presets rather than babel-preset-expo.
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
  testPathIgnorePatterns: ['/node_modules/', '/.claude/'],
  setupFilesAfterEnv: ['<rootDir>/jest-setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // Jest picks lucide's `react-native` export condition, which is untransformed
    // ESM. Metro handles that; jest does not, so point it at the CJS build.
    '^lucide-react-native/icons/(.*)$': '<rootDir>/node_modules/lucide-react-native/dist/cjs/icons/$1.js',
  },
};
