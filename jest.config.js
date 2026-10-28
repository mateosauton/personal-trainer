/**
 * Keep core workout logic, persistence, and security tests here.
 * React tests cover account races plus the onboarding/profile measurement regressions.
 * Broader screen, animation, and UX tests stay outside this suite.
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: [
    '<rootDir>/__tests__/**/*.test.ts',
    '<rootDir>/__tests__/auth-provider.test.tsx',
    '<rootDir>/__tests__/auth-screens.test.tsx',
    '<rootDir>/__tests__/onboarding-layout.test.tsx',
    '<rootDir>/__tests__/profile-measurements.test.tsx',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/.claude/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
