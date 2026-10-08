import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { ComponentType } from 'react';

// Expo Go does not include ExpoObserve. Load it only in native builds/web.
const observe = Constants.executionEnvironment === ExecutionEnvironment.StoreClient
  ? null
  : require('expo-observe') as typeof import('expo-observe');

const markInteractive = () => {};

export const ObserveRoot = observe?.ObserveRoot ?? {
  wrap: <P extends Record<string, unknown>>(Component: ComponentType<P>) => Component,
};

export const useObserve = observe?.useObserve ?? (() => ({ markInteractive }));
