import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

/** Expo Go cannot register the app scheme needed for browser OAuth callbacks. */
export function canUseBrowserOAuth(): boolean {
  return Platform.OS === 'web' || Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}
