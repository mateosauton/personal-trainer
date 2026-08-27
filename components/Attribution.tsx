import { Linking, StyleSheet, View } from 'react-native';

import { Muted, Overline } from '@/components/ui';
import { colors, space } from '@/lib/theme';

/**
 * free-exercise-db is public domain under the Unlicense, so this credit is
 * courtesy rather than obligation -- but the dataset does the heavy lifting
 * here and deserves the line.
 */
export function Attribution() {
  return (
    <View style={styles.wrap}>
      <Overline>Exercise data & images</Overline>
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
