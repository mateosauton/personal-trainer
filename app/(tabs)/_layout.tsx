import { Tabs } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { colors, space, type } from '@/lib/theme';

/**
 * Text tabs rather than icons: four words are unambiguous where four glyphs
 * would need learning, and it matches the type-forward feel of the rest.
 */
function TabLabel({ label, focused }: { label: string; focused: boolean }) {
  return (
    <View style={styles.tab}>
      <Text style={[styles.label, focused && styles.labelActive]}>{label}</Text>
      <View style={[styles.dot, focused && styles.dotActive]} />
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.bar,
        tabBarShowLabel: true,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ tabBarIcon: () => null, tabBarLabel: ({ focused }) => <TabLabel label="Today" focused={focused} /> }}
      />
      <Tabs.Screen
        name="plan"
        options={{ tabBarIcon: () => null, tabBarLabel: ({ focused }) => <TabLabel label="Plan" focused={focused} /> }}
      />
      <Tabs.Screen
        name="history"
        options={{ tabBarIcon: () => null, tabBarLabel: ({ focused }) => <TabLabel label="History" focused={focused} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ tabBarIcon: () => null, tabBarLabel: ({ focused }) => <TabLabel label="You" focused={focused} /> }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    height: 88,
    paddingTop: space.md,
  },
  tab: { alignItems: 'center', gap: 6, width: 72 },
  label: { ...type.overline, color: colors.faint },
  labelActive: { color: colors.text },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  dotActive: { backgroundColor: colors.accent },
});
