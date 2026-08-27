import { Stack } from 'expo-router';

import { colors } from '@/lib/theme';

/**
 * Overview -> run -> summary is its own stack so the player can replace itself
 * without unwinding the tabs underneath.
 */
export default function SessionLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
      }}
    />
  );
}
