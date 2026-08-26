import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Muted, Overline, ProgressBar } from '@/components/ui';
import { colors, radius, space, type } from '@/lib/theme';
import { Body } from '@/components/ui';

interface Props {
  seconds: number;
  /** Shown underneath so the user knows what they are resting for. */
  nextLabel: string;
  onDone: () => void;
}

/**
 * Counts down between sets. It buzzes once at zero and then waits: auto-
 * advancing would yank the screen away from someone still walking back to the
 * rack.
 */
export function RestTimer({ seconds, nextLabel, onDone }: Props) {
  const [remaining, setRemaining] = useState(seconds);
  const firedRef = useRef(false);

  useEffect(() => {
    setRemaining(seconds);
    firedRef.current = false;
    const id = setInterval(() => {
      setRemaining((value) => (value <= 0 ? 0 : value - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [seconds]);

  useEffect(() => {
    if (remaining > 0 || firedRef.current) return;
    firedRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [remaining]);

  const minutes = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const done = remaining <= 0;

  return (
    <View style={styles.card}>
      <Overline>{done ? 'Rest complete' : 'Resting'}</Overline>
      <Body style={styles.clock}>
        {minutes}:{String(secs).padStart(2, '0')}
      </Body>
      <ProgressBar value={seconds === 0 ? 1 : 1 - remaining / seconds} />
      <Muted style={{ marginTop: space.sm }} numberOfLines={2}>
        Up next · {nextLabel}
      </Muted>
      <Button
        title={done ? 'Next set' : 'Skip rest'}
        variant={done ? 'accent' : 'surface'}
        onPress={onDone}
        style={{ marginTop: space.lg }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.elevated,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
  clock: { ...type.numeral, color: colors.accent, marginVertical: space.sm },
});
