import { Tabs } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/components/Icon';
import { colors, radius, space, type } from '@/lib/theme';

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
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, space.lg);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: [styles.bar, { bottom }],
        tabBarShowLabel: false,
        tabBarLabelPosition: 'below-icon',
        tabBarIconStyle: styles.iconSlot,
        sceneStyle: { backgroundColor: colors.bg, paddingBottom: 64 + bottom },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarAccessibilityLabel: 'Home',
          tabBarIcon: ({ focused }) => <TabItem icon="home" label="Home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: 'Plan',
          tabBarAccessibilityLabel: 'Plan',
          tabBarIcon: ({ focused }) => <TabItem icon="plan" label="Plan" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.lg,
    height: 64,
    // The floating dock handles its safe-area offset outside the content.
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  iconSlot: { flex: 1, width: '100%', height: 'auto' },
  tab: { alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { ...type.overline, color: colors.faint },
  labelActive: { color: colors.text },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  dotActive: { backgroundColor: colors.accent },
});
