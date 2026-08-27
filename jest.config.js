/**
 * Only the pure logic under lib/ is unit-tested here (plan generation,
 * progression, media resolution). Component rendering is verified on a real
 * device via Expo Go, which is faster to trust than a mocked native runtime.
 *
 * These tests never touch React Native, so they compile with plain Babel
 * presets rather than babel-preset-expo.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  // .claude/ holds throwaway git worktrees, whose copies of these same suites
  // would otherwise be collected and run again.
  testPathIgnorePatterns: ['/node_modules/', '/.claude/'],
  transform: {
    '^.+\\.tsx?$': [
      'babel-jest',
      {
        // Ignore the project babel.config.js: it pulls in
        // babel-preset-expo and the Reanimated worklets plugin, neither of
        // which these node-side tests need.
        configFile: false,
        babelrc: false,
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
};
