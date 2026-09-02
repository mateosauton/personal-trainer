import { render } from '@testing-library/react-native';

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
    render(<TabsLayout />);
    const bar = capturedOptions.current?.tabBarStyle as Record<string, number | string>;

    expect(bar.height).toBe(64);
    expect(bar.position).toBe('absolute');
    expect(bar.bottom).toBe(16);
    expect(bar.left).toBe(16);
    expect(bar.right).toBe(16);
  });
});
