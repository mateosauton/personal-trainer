import { requireOptionalNativeModule } from 'expo';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

// Expo Go does not include the native Observe/AppMetrics modules. Keep metrics
// enabled in development and production builds without blocking Expo Go startup.
const observe: Pick<typeof import('expo-observe'), 'ObserveRoot' | 'useObserve'> =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  (Platform.OS !== 'web' &&
    (!requireOptionalNativeModule('ExpoObserve') || !requireOptionalNativeModule('ExpoAppMetrics')))
    ? {
        ObserveRoot: { wrap: (Component: React.ComponentType<any>) => Component } as typeof import('expo-observe').ObserveRoot,
        useObserve: () => ({ markInteractive: () => {} }) as ReturnType<typeof import('expo-observe').useObserve>,
      }
    : require('expo-observe');

export const { ObserveRoot, useObserve } = observe;
