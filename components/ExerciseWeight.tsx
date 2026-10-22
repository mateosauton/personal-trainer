import { StyleSheet, TextInput, View } from 'react-native';

import { Body, Card, Heading, Muted, Overline } from '@/components/ui';
import { colors, radius, space, type, webFocusRing } from '@/lib/theme';
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
  const weightKg = validWeight(suggestion.weightKg);
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
          accessibilityLabel={`${isBodyweight ? 'Added load' : 'Weight'} to use (${units})`}
          keyboardType="decimal-pad"
          value={value}
          onChangeText={onChangeText}
          editable={!disabled}
          placeholder="0"
          placeholderTextColor={colors.faint}
          selectTextOnFocus
          style={[styles.input, webFocusRing, disabled && styles.disabled]}
        />
        <Body>{units}{isBodyweight ? ' added load' : ''}</Body>
      </View>
    </Card>
  );
}

export function ExerciseWeightProgressCard({
  progress,
  units,
  isBodyweight,
  setsCompleted,
  historyAvailable = true,
}: {
  progress: { topWeightKg: number | null; previousWeightKg: number | null; deltaKg: number | null };
  units: Units;
  isBodyweight: boolean;
  setsCompleted: number;
  historyAvailable?: boolean;
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

  return (
    <Card style={styles.card} accessibilityLiveRegion="polite">
      <Overline style={styles.complete}>Exercise complete</Overline>
      <Muted>{setsCompleted} {setsCompleted === 1 ? 'set' : 'sets'} completed</Muted>
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
  complete: { color: colors.accent },
  result: { gap: space.xs },
  increase: { color: colors.accent },
});
