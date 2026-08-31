import { Tabs } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { colors, space, type } from '@/lib/theme';

/**
 * Two tabs only. Profile moved to its own modal behind the avatar on Home, and
 * History folded into Plan, because both were navigation-level answers to
 * things that belong inside a screen: who you are, and what you have done.
 */
function TabItem({ icon, label, focused }: { icon: IconName; label: string; focused: boolean }) {
  return (
    <View style={styles.tab}>
      <Icon name={icon} size={22} color={focused ? colors.text : colors.faint} />
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
        options={{
          tabBarIcon: () => null,
          tabBarLabel: ({ focused }) => <TabItem icon="home" label="Home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          tabBarIcon: () => null,
          tabBarLabel: ({ focused }) => <TabItem icon="plan" label="Plan" focused={focused} />,
        }}
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
    paddingTop: space.sm,
  },
  tab: { alignItems: 'center', gap: 5, width: 96 },
  label: { ...type.overline, color: colors.faint },
  labelActive: { color: colors.text },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  dotActive: { backgroundColor: colors.accent },
});
