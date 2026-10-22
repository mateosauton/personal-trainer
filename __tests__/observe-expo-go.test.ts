jest.mock('expo', () => ({
  requireOptionalNativeModule: () => null,
}));

jest.mock('expo-observe', () => {
  throw new Error('Expo Go has no ExpoAppMetrics native module');
});

import { ObserveRoot, useObserve } from '@/lib/observe';

it('keeps Expo Go startup independent of native Observe modules', () => {
  const Component = () => null;
  expect(ObserveRoot.wrap(Component)).toBe(Component);
  expect(() => useObserve().markInteractive()).not.toThrow();
});
