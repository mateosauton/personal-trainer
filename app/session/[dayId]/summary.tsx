import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import { DoodlePop } from '@/components/Doodle';
import {
  Body,
  Button,
  Card,
  Chip,
  Display,
  Heading,
  Muted,
  Overline,
  Screen,
} from '@/components/ui';
import { notify } from '@/lib/alerts';
import { useAuth, useUserId } from '@/lib/auth';
import {
  applySessionProgress,
  getSessionProgressResult,
  getSessionPlanDay,
  getProgress,
  getSessionSetSnapshot,
  type SessionSummaryLine,
} from '@/lib/db/queries';
import {
  failedSyncCount,
  flushOutbox,
  getLocalSessionReceipt,
  queueCompletion,
  pendingSyncCount,
} from '@/lib/session/sync';
import { workouts } from '@/lib/session/workout';
import { calculateSessionSummary, finalizeWorkout } from '@/lib/session/finalize';
import { clientForAccessToken } from '@/lib/db/supabase';
import { colors, space, type } from '@/lib/theme';
import { motion } from '@/lib/motion';
import { formatWeight } from '@/lib/units';
import type { Units } from '@/lib/types';

export default function SessionSummary() {
  const { dayId, sessionId, elapsed } = useLocalSearchParams<{
    dayId: string;
    sessionId: string;
    elapsed: string;
  }>();
  const userId = useUserId();
  const { profile, session } = useAuth();
  const router = useRouter();

  const [lines, setLines] = useState<SessionSummaryLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const routeDurationS = Number.parseInt(elapsed ?? '0', 10) || 0;
  const [durationS, setDurationS] = useState(routeDurationS);
  const [syncState, setSyncState] = useState<'pending' | 'review' | null>(null);
  const identity = `${userId}:${sessionId}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const profileUnits = profile?.units ?? 'kg';
  const [units, setUnits] = useState<Units>(profileUnits);

  useEffect(() => {
    let cancelled = false;
    let polling: ReturnType<typeof setInterval> | undefined;
    let refreshing = false;
    const controller = new AbortController();
    const guard = () => {
      if (cancelled || currentIdentity.current !== identity || controller.signal.aborted)
        throw Object.assign(new Error('Workout summary closed.'), { name: 'AbortError' });
    };
    const showConfirmed = (confirmed: SessionSummaryLine[], confirmedUnits: Units, seconds: number) => {
      guard();
      setLines(confirmed);
      setUnits(confirmedUnits);
      setDurationS(seconds);
      setSyncState(null);
      setLoading(false);
      if (polling !== undefined) clearInterval(polling);
      polling = undefined;
    };
    const refreshLocalReceipt = async () => {
      if (refreshing || cancelled) return;
      refreshing = true;
      try {
        guard();
        const receipt = await getLocalSessionReceipt(userId, sessionId);
        guard();
        if (receipt) {
          showConfirmed(receipt.lines, receipt.units, receipt.durationS);
          return;
        }
        const failed = await failedSyncCount(sessionId);
        guard();
        setSyncState(failed > 0 ? 'review' : 'pending');
      } finally { refreshing = false; }
    };
    setLoading(true);
    setError(null);
    setSyncState(null);
    setDurationS(routeDurationS);

    (async () => {
      // A confirmed local receipt is available without contacting the backend.
      const receipt = await getLocalSessionReceipt(userId, sessionId);
      guard();
      if (receipt) {
        showConfirmed(receipt.lines, receipt.units, receipt.durationS);
        return;
      }
      const local = await workouts.read(userId);
      guard();
      const captured = local?.ownerId === userId && local.sessionId === sessionId ? local : null;
      if (captured?.endedAtMs != null) {
        const observed = calculateSessionSummary(captured.day,
          (captured.recordedSets ?? []).map(([, set]) => set),
          new Map(captured.progress.map(row => [row.exercise_id, row])),
          captured.units, captured.bodyweightKg ?? null);
        // These are observed metrics, not a confirmed progression result or PR.
        setLines(observed.lines.map(line => ({ ...line, verdict: null, isPr: false })));
        setUnits(captured.units);
        const seconds = Math.max(1, captured.timing
          ? Math.floor(captured.timing.plannedSeconds + ((captured.timing.session.pausedAt
            ?? captured.endedAtMs) - captured.timing.session.endAt) / 1000)
          : Math.floor((captured.endedAtMs - captured.startedAtMs) / 1000));
        setDurationS(seconds);
        setSyncState('pending');
        setLoading(false);
        polling = setInterval(() => { void refreshLocalReceipt().catch(() => undefined); }, 5000);
        void refreshLocalReceipt().catch(() => undefined);
        // Keep the saved snapshot until sync has durably stored its confirmed receipt.
        void (async () => {
          try {
            await queueCompletion(userId, sessionId, seconds);
            guard();
            await flushOutbox();
          } catch {
            // The local preview and durable workout remain available for recovery.
          } finally {
            await refreshLocalReceipt().catch(() => undefined);
          }
        })();
        return;
      }

      // Historical summaries still require a complete acknowledged server snapshot.
      await flushOutbox();
      guard();
      if ((await failedSyncCount(sessionId)) > 0)
        throw new Error('Some sets could not sync. Retry workout sync from Home before saving this summary.');
      guard();
      if ((await pendingSyncCount(sessionId)) > 0)
        throw new Error('Your workout is still syncing. Reconnect and retry to see all your sets.');
      guard();
      const client = session?.access_token ? clientForAccessToken(session.access_token) : undefined;
      const previous = await getSessionProgressResult(sessionId, client, controller.signal);
      guard();
      const calculationUnits = captured?.units ?? profileUnits;
      if (previous !== null) {
        await workouts.clear(userId, sessionId, captured ?? undefined);
        guard();
        showConfirmed(previous, calculationUnits, routeDurationS);
        return;
      }
      const day = await getSessionPlanDay(sessionId, userId, client, controller.signal);
      guard();
      if (!day) throw new Error('Could not load the original workout day. Please retry.');
      const saved = await finalizeWorkout({ ownerId: userId, sessionId, day, units: calculationUnits,
        bodyweightKg: captured?.bodyweightKg !== undefined ? captured.bodyweightKg : profile?.bodyweight_kg ?? null,
      }, {
        guard,
        // The receipt was checked before loading its original day.
        getReceipt: async () => previous,
        getSnapshot: (id, signal) => getSessionSetSnapshot(id, client, signal),
        getProgress: (owner, signal) => getProgress(owner, client, signal),
        applyProgress: (id, expected, updates, result, versions, signal) =>
          applySessionProgress(id, expected, updates, result, versions, client, signal),
      }, controller.signal);
      guard();
      await workouts.clear(userId, sessionId, captured ?? undefined);
      guard();
      showConfirmed(saved, calculationUnits, routeDurationS);
      if (saved.some(line => line.isPr))
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    })().catch((failure: unknown) => {
      if (!cancelled && currentIdentity.current === identity) {
        setError(failure instanceof Error ? failure.message : 'Could not load your workout. Please retry.');
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
      if (polling !== undefined) clearInterval(polling);
    };
  }, [sessionId, userId, dayId, profile?.bodyweight_kg, profileUnits, session?.access_token, retry]);

  const save = async () => {
    setSaving(true);
    try {
      // The effort scale is gone from the UI; the column stays nullable.
      router.replace('/(tabs)');
    } catch (e) {
      notify('Could not save', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Screen scroll={false} style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen scroll={false} style={styles.center}>
        <Heading>Summary unavailable</Heading>
        <Body style={{ marginTop: space.md }}>{error}</Body>
        <Button
          title="Retry"
          onPress={() => setRetry((value) => value + 1)}
          style={{ marginTop: space.lg }}
        />
        <Button
          title="Back to home"
          variant="ghost"
          onPress={() => router.replace('/(tabs)')}
        />
      </Screen>
    );
  }

  const totalVolume = lines.reduce((sum, l) => sum + l.volumeKg, 0);
  const totalSets = lines.reduce((sum, l) => sum + l.sets, 0);

  return (
    <Screen>
      <Overline>Session complete</Overline>
      <Display style={{ marginTop: space.sm }}>Nice work.</Display>
      {syncState ? <Body style={{ marginTop: space.md }}>
        {syncState === 'review'
          ? 'Some saved sets need review. Open Home to resolve them.'
          : 'Saved on this device. Waiting to sync.'}
      </Body> : null}

      <Animated.View
        entering={FadeIn.duration(motion.base).reduceMotion(
          ReduceMotion.System,
        )}
      >
        <Card style={{ marginTop: space.xl }}>
          <View style={styles.stats}>
            <Stat
              label="Minutes"
              value={`${Math.max(1, Math.round(durationS / 60))}`}
            />
            <Stat label="Sets" value={`${totalSets}`} />
            <Stat label="Volume" value={formatWeight(totalVolume, units)} />
          </View>
        </Card>
      </Animated.View>

      <View style={{ gap: space.md, marginTop: space.xl }}>
        {lines.map((line, index) => (
          <Animated.View
            key={line.exerciseId}
            entering={FadeIn.delay(index * 55)
              .duration(motion.base)
              .reduceMotion(ReduceMotion.System)}
            style={styles.line}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Body style={styles.lineName} numberOfLines={1}>
                {line.name}
              </Body>
              <Muted>
                {line.seconds != null
                  ? `${line.sets} sets · ${line.seconds > 0 ? `${line.seconds}s timed` : 'Duration not recorded'}`
                  : `${line.sets} sets · top ${formatWeight(line.topLoadKg, units)}`}
              </Muted>
            </View>
            {line.isPr ? (
              <DoodlePop>
                {/* The badge carries the number that earned it: a bare "PR" makes
                    you go looking for the weight it is talking about. */}
                <Chip label={prLabel(line.topLoadKg, units)} selected />
              </DoodlePop>
            ) : null}
            {!line.isPr && line.verdict === 'progress' ? (
              <Chip label="↑ next" />
            ) : null}
            {!line.isPr && line.verdict === 'deload' ? (
              <Chip label="↓ next" />
            ) : null}
          </Animated.View>
        ))}
      </View>

      <Button
        title="Done"
        onPress={save}
        loading={saving}
        style={{ marginTop: space.xl }}
      />
    </Screen>
  );
}

/** Bodyweight work with nothing added has no weight worth printing. */
const prLabel = (topLoadKg: number | null, units: Units) =>
  topLoadKg ? `PR ${formatWeight(topLoadKg, units)}` : 'PR';

const Stat = ({ label, value }: { label: string; value: string }) => (
  <View style={{ gap: 2 }}>
    <Heading>{value}</Heading>
    <Overline>{label}</Overline>
  </View>
);

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', justifyContent: 'space-between' },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lineName: { ...type.body, fontWeight: '600' },
});
