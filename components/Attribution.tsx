import { Linking, StyleSheet, View } from 'react-native';

import { Muted, Overline } from '@/components/ui';
import { colors, space } from '@/lib/theme';

/**
 * Required, not decorative. The 16 animated demos come from the RepDB preview
 * pack under CC BY-NC 4.0, which obliges credit and permits non-commercial use
 * only. The remaining artwork is free-exercise-db, public domain under the
 * Unlicense, which asks for nothing but is worth crediting anyway.
 */
export function Attribution() {
  return (
    <View style={styles.wrap}>
      <Overline>Exercise data & images</Overline>
      <Muted style={styles.line} onPress={() => Linking.openURL('https://repdb.co')}>
        RepDB (repdb.co) — preview pack, CC BY-NC 4.0. Non-commercial use.
      </Muted>
      <Muted
        style={styles.line}
        onPress={() => Linking.openURL('https://github.com/yuhonas/free-exercise-db')}
      >
        free-exercise-db — public domain (Unlicense).
      </Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: space.xxl,
    paddingTop: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: space.xs,
  },
  line: { textDecorationLine: 'underline' },
});
