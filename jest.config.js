/**
 * Keep core workout logic, persistence, and security tests here.
 * The only React test mounts a headless auth provider to check account races.
 * Screen rendering, layout, animation, and UX tests are outside this suite.
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: [
    '<rootDir>/__tests__/**/*.test.ts',
    '<rootDir>/__tests__/auth-provider.test.tsx',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/.claude/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
