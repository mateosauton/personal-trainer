// Reanimated 4 uses react-native-worklets, whose native implementation is not
// available in Jest. Its mock must load before Reanimated initializes.
jest.mock('react-native-worklets', () =>
  require('react-native-worklets/src/mock')
);

require('react-native-reanimated').setUpTests();
