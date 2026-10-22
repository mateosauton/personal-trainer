import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

const capturedOptions: { current: Record<string, unknown> | null } = { current: null };

jest.mock('expo-router', () => {
  const { View } = require('react-native');
  const Tabs = ({
    screenOptions,
    children,
  }: {
    screenOptions: Record<string, unknown>;
    children: React.ReactNode;
  }) => {
    capturedOptions.current = screenOptions;
    return <View>{children}</View>;
  };
  Tabs.Screen = () => null;

  return { Tabs };
});

import TabsLayout from '@/app/(tabs)/_layout';

describe('TabsLayout', () => {
  it('uses a compact, raised navigation dock', () => {
    render(
      <SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <TabsLayout />
      </SafeAreaInsetsContext.Provider>,
    );
    const bar = StyleSheet.flatten(capturedOptions.current?.tabBarStyle as object) as Record<string, number | string>;

    expect(bar.height).toBe(64);
    expect(bar.position).toBe('absolute');
    expect(bar.bottom).toBe(16);
    expect(bar.left).toBe(16);
    expect(bar.right).toBe(16);
  });
});
