import { useId } from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Body } from '@/components/ui';
import { colors, radius, space, type, webFocusRing } from '@/lib/theme';

interface Props {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  /** Shown inside the field, after the number: "kg", "cm". */
  unit?: string;
  accessibilityLabel?: string;
  autoFocus?: boolean;
}

/**
 * A number entry that can be got out of.
 *
 * `decimal-pad` has no return key, so a plain TextInput with a numeric keyboard
 * is a trap on iOS: the keyboard covers the rest of the screen and nothing
 * dismisses it. This pairs the field with a Done bar above the keyboard, which
 * is the only affordance iOS gives for that pad.
 */
export function NumberField({
  value,
  onChangeText,
  placeholder,
  unit,
  accessibilityLabel,
  autoFocus,
}: Props) {
  // InputAccessoryView needs a stable id shared by the input and the bar.
  const accessoryId = `number-field-${useId()}`;
  const showsAccessory = Platform.OS === 'ios';

  return (
    <>
      <View style={styles.field}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.faint}
          keyboardType="decimal-pad"
          inputMode="decimal"
          returnKeyType="done"
          accessibilityLabel={accessibilityLabel}
          autoFocus={autoFocus}
          onSubmitEditing={Keyboard.dismiss}
          inputAccessoryViewID={showsAccessory ? accessoryId : undefined}
        />
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>

      {showsAccessory ? (
        <InputAccessoryView nativeID={accessoryId}>
          <View style={styles.accessory}>
            <Pressable
              accessibilityRole="button"
              onPress={Keyboard.dismiss}
              hitSlop={12}
              style={({ pressed }) => [styles.done, pressed && { opacity: 0.6 }]}
            >
              <Body style={styles.doneLabel}>Done</Body>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  input: {
    ...type.numeral,
    color: colors.text,
    flexShrink: 1,
    minWidth: 120,
    textAlign: 'center',
    ...webFocusRing,
  },
  unit: { ...type.body, color: colors.muted },
  accessory: {
    backgroundColor: colors.elevated,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'flex-end',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  done: { paddingHorizontal: space.md, paddingVertical: space.xs },
  doneLabel: { ...type.body, fontWeight: '700', color: colors.accent },
});
