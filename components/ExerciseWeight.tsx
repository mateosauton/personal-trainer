import { useId } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { DoneAccessory, numericDoneProps } from '@/components/NumberField';
import { Body, Card, Heading, Muted, Overline } from '@/components/ui';
import { colors, radius, space, type, webFocusRing } from '@/lib/theme';
import { SetEntry } from '@/lib/session/set-entry';
import type { Units } from '@/lib/types';
import { formatWeight, kgToDisplay } from '@/lib/units';
import type { WeightSuggestion } from '@/lib/weights';

function validWeight(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

function loadLabel(weightKg: number, units: Units, isBodyweight: boolean): string {
  return isBodyweight && weightKg === 0 ? 'Bodyweight · No added load' : formatWeight(weightKg, units);
}

export function WeightSuggestionCard({
  suggestion,
  units,
  value,
  onChangeText,
  isBodyweight,
  sourceName,
  disabled,
}: {
  suggestion: WeightSuggestion;
  units: Units;
  value: string;
  onChangeText: (text: string) => void;
  isBodyweight: boolean;
  sourceName?: string;
  disabled?: boolean;
}) {
  const accessoryId = `suggested-load-${useId()}`;
  const weightKg = validWeight(suggestion.weightKg);
  const invalid = value.trim() !== '' && SetEntry.weightFromText(value) == null;
  const source = suggestion.source === 'progress'
    ? 'Saved target'
    : suggestion.source === 'history'
      ? 'Previous workout'
      : suggestion.source === 'session'
        ? 'Earlier set today'
        : null;

  return (
    <Card style={styles.card}>
      <Overline>{isBodyweight ? 'Suggested added load' : 'Suggested weight'}</Overline>
      {weightKg == null ? (
        <Heading>Record your starting weight</Heading>
      ) : (
        <Heading>{loadLabel(weightKg, units, isBodyweight)}</Heading>
      )}
      {source ? <Muted>{sourceName ? `${source} · ${sourceName}` : source}</Muted> : null}
      <View style={styles.inputRow}>
        <TextInput
          accessibilityLabel={SetEntry.fieldName('weight', units, isBodyweight)}
          value={value}
          onChangeText={onChangeText}
          editable={!disabled}
          placeholder="0"
          placeholderTextColor={colors.faint}
          selectTextOnFocus
          {...numericDoneProps(accessoryId)}
          style={[styles.input, webFocusRing, disabled && styles.disabled]}
        />
        <Body>{units}{isBodyweight ? ' added load' : ''}</Body>
      </View>
      <DoneAccessory nativeID={accessoryId} />
      {invalid ? <Muted accessibilityLiveRegion="polite" style={styles.error}>{SetEntry.weightError()}</Muted> : null}
    </Card>
  );
}

export function ExerciseWeightProgressCard({
  progress,
  units,
  isBodyweight,
  setsCompleted,
  historyAvailable = true,
  compact = false,
}: {
  progress: { topWeightKg: number | null; previousWeightKg: number | null; deltaKg: number | null };
  units: Units;
  isBodyweight: boolean;
  setsCompleted: number;
  historyAvailable?: boolean;
  /** One result line plus the comparison, so rest can keep its action on screen. */
  compact?: boolean;
}) {
  const top = validWeight(progress.topWeightKg);
  const previous = validWeight(progress.previousWeightKg);
  const delta = progress.deltaKg != null && Number.isFinite(progress.deltaKg)
    ? Math.round(kgToDisplay(progress.deltaKg, units) * 10) / 10
    : null;
  const comparison = previous == null
    ? (historyAvailable ? 'First recorded workout' : 'Previous workout unavailable')
    : `${isBodyweight ? 'Previous added load' : 'Previous workout'}: ${loadLabel(previous, units, isBodyweight)}`;
  const deltaLabel = delta == null ? null : delta === 0
    ? 'No change from previous workout'
    : `${delta > 0 ? '+' : ''}${delta} ${units}${isBodyweight ? ' added load' : ''} vs previous workout`;

  const setsLabel = `${setsCompleted} ${setsCompleted === 1 ? 'set' : 'sets'}`;
  if (compact) {
    return (
      <Card style={styles.card} accessibilityLiveRegion="polite">
        <Overline style={styles.complete}>Exercise complete</Overline>
        <Heading>{top == null ? 'No weight recorded' : loadLabel(top, units, isBodyweight)}</Heading>
        <Muted>{setsLabel} · {comparison}</Muted>
        {top != null && previous != null && deltaLabel ? (
          <Body style={delta != null && delta > 0 ? styles.increase : undefined}>{deltaLabel}</Body>
        ) : null}
      </Card>
    );
  }

  return (
    <Card style={styles.card} accessibilityLiveRegion="polite">
      <Overline style={styles.complete}>Exercise complete</Overline>
      <Muted>{setsLabel} completed</Muted>
      <View style={styles.result}>
        <Muted>{isBodyweight ? 'Top added load today' : 'Top weight today'}</Muted>
        <Heading>{top == null ? 'No weight recorded' : loadLabel(top, units, isBodyweight)}</Heading>
      </View>
      <Muted>{comparison}</Muted>
      {top != null && previous != null && deltaLabel ? (
        <Body style={delta != null && delta > 0 ? styles.increase : undefined}>{deltaLabel}</Body>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  input: {
    ...type.heading,
    color: colors.text,
    backgroundColor: colors.bg,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: space.md,
    minHeight: 52,
    minWidth: 100,
    flex: 1,
  },
  disabled: { opacity: 0.5 },
  error: { color: colors.danger },
  complete: { color: colors.accent },
  result: { gap: space.xs },
  increase: { color: colors.accent },
});
