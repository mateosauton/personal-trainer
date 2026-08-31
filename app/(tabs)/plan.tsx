import { format } from 'date-fns';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Calendar } from '@/components/Calendar';
import { ExerciseMedia } from '@/components/ExerciseMedia';
import { Body, Button, Card, Display, Heading, Muted, Overline, Screen } from '@/components/ui';
import { useAuth, useUserId } from '@/lib/auth';
import { getExercise } from '@/lib/catalog';
import { getSetLogsForSessions } from '@/lib/db/queries';
import { bodyPartLabel, estimateDay } from '@/lib/plan/estimate';
import { sessionTotals, type Totals } from '@/lib/stats';
import { colors, space, type } from '@/lib/theme';
import { formatWeight } from '@/lib/units';
import { useDashboard, type HistorySession } from '@/lib/useDashboard';

/**
 * The plan and the record of it, on one screen. History was its own tab, which
 * meant what you did and what you are meant to do never appeared together;
 * here a trained day on the calendar opens the session that filled it.
 */
export default function PlanTab() {
  const userId = useUserId();
  const { profile } = useAuth();
  const router = useRouter();
  const bodyweightKg = profile?.bodyweight_kg ?? null;
  const { plan, nextDay, sessions, trainedDays, loading, reload } = useDashboard(
    userId,
    bodyweightKg,
  );

  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedTotals, setSelectedTotals] = useState<Totals | null>(null);
  // Picking a session out of the history opens it against the calendar, which
  // sits above the list -- so the tap has to take the user back up to it.
  const scrollRef = useRef<ScrollView>(null);
  const calendarY = useRef(0);

  const openDay = useCallback((key: string) => {
    setSelected(key);
    scrollRef.current?.scrollTo({ y: Math.max(0, calendarY.current - space.lg), animated: true });
  }, []);

  useFocusEffect(useCallback(() => reload(), [reload]));

  const units = profile?.units ?? 'kg';
  const daySessions: HistorySession[] = selected
    ? sessions.filter((s) => s.local_day === selected)
    : [];

  // Set logs are only worth fetching for the day the user actually opened.
  useEffect(() => {
    let cancelled = false;
    const ids = daySessions.map((s) => s.id);
    if (ids.length === 0) {
      setSelectedTotals(null);
      return;
    }
    getSetLogsForSessions(ids)
      .then((logs) => {
        if (!cancelled) setSelectedTotals(sessionTotals(logs, bodyweightKg));
      })
      .catch(() => {
        if (!cancelled) setSelectedTotals(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, sessions.length, bodyweightKg]);

  if (loading) {
    return (
      <Screen scroll={false} style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  }

  if (!plan) {
    return (
      <Screen>
        <Display>No plan yet.</Display>
        <Muted style={{ marginTop: space.md }}>Build one from your profile.</Muted>
      </Screen>
    );
  }

  return (
    <Screen ref={scrollRef}>
      <Overline>Your plan</Overline>
      <Display style={{ marginTop: space.sm }}>{plan.name}</Display>
      <Muted style={{ marginTop: space.sm }}>
        {plan.days.length} days a week · {plan.weeks} week block · {sessions.length} logged
      </Muted>

      <View
        style={{ marginTop: space.xl }}
        onLayout={(e) => {
          calendarY.current = e.nativeEvent.layout.y;
        }}
      >
        <Calendar trainedDays={trainedDays} selected={selected} onSelect={setSelected} />
      </View>

      {selected && daySessions.length > 0 ? (
        <Card style={styles.dayCard}>
          <Overline>{format(new Date(`${selected}T00:00:00`), 'EEEE d MMMM')}</Overline>
          {daySessions.map((session) => (
            <View key={session.id} style={{ gap: 2 }}>
              <Body style={styles.strong}>{session.plan_days?.name ?? 'Session'}</Body>
              <Muted>
                {session.plan_days?.focus ?? '—'}
                {session.duration_s ? ` · ${Math.round(session.duration_s / 60)} min` : ''}
                {session.rpe ? ` · RPE ${session.rpe}` : ''}
              </Muted>
            </View>
          ))}
          {selectedTotals ? (
            <View style={styles.stats}>
              <Stat label="Sets" value={`${selectedTotals.sets}`} />
              <Stat label="Reps" value={`${selectedTotals.reps}`} />
              <Stat
                label="Volume"
                value={selectedTotals.volumeKg > 0 ? formatWeight(selectedTotals.volumeKg, units) : '—'}
              />
            </View>
          ) : null}
        </Card>
      ) : null}

      <Overline style={{ marginTop: space.xxl }}>Sessions in this plan</Overline>

      <View style={{ gap: space.lg, marginTop: space.lg }}>
        {plan.days.map((day) => {
          const isNext = day.id === nextDay?.id;
          const open = expanded === day.id;
          const estimate = estimateDay(day);
          const work = day.blocks.filter((b) => b.kind !== 'warmup');
          const cover = getExercise(work[0]?.items[0]?.exercise_id ?? '');

          return (
            <Card key={day.id} style={isNext ? styles.nextCard : undefined}>
              <Pressable
                onPress={() => setExpanded(open ? null : day.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${day.name} details`}
                style={styles.cardHead}
              >
                {cover ? <ExerciseMedia exercise={cover} style={styles.thumb} paused /> : null}
                <View style={{ flex: 1, gap: 2 }}>
                  <Overline style={isNext ? { color: colors.accent } : undefined}>
                    {isNext ? 'Up next' : `Day ${day.day_index + 1}`}
                  </Overline>
                  <Body style={styles.dayName}>{day.name}</Body>
                  <Muted numberOfLines={2}>{bodyPartLabel(estimate.bodyParts)}</Muted>
                </View>
                <Muted>{open ? '▲' : '▼'}</Muted>
              </Pressable>

              <View style={styles.stats}>
                <Stat label="Reps" value={`${estimate.reps}`} />
                <Stat label="Est. min" value={`${estimate.minutes}`} />
                <Stat label="Blocks" value={`${estimate.blocks}`} />
                <Stat label="Sets" value={`${estimate.sets}`} />
              </View>

              {open ? (
                <View style={{ gap: space.lg, marginTop: space.lg }}>
                  {day.blocks.map((block) => (
                    <View key={block.id} style={{ gap: space.xs }}>
                      <Overline>{block.title}</Overline>
                      <Muted>
                        {block.kind === 'warmup'
                          ? 'Move through once'
                          : block.kind === 'straight'
                            ? `Straight sets · rest ${block.rest_seconds}s`
                            : `${block.kind === 'superset' ? 'Superset' : 'Circuit'} · ${block.rounds} rounds · rest ${block.rest_seconds}s`}
                      </Muted>
                      {block.items.map((item) => (
                        <View key={item.id} style={styles.itemRow}>
                          <Body style={styles.itemName} numberOfLines={1}>
                            {getExercise(item.exercise_id)?.name ?? item.exercise_id}
                          </Body>
                          <Muted>
                            {item.seconds
                              ? `${item.seconds}s`
                              : block.kind === 'straight'
                                ? `${item.sets} × ${item.reps_low}–${item.reps_high}`
                                : `${item.reps_low}–${item.reps_high}`}
                          </Muted>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              ) : null}

              <Button
                title={isNext ? 'Start this session' : 'View session'}
                variant={isNext ? 'accent' : 'surface'}
                onPress={() => router.push(`/session/${day.id}`)}
                style={{ marginTop: space.lg }}
              />
            </Card>
          );
        })}
      </View>

      {sessions.length > 0 ? (
        <>
          <Overline style={{ marginTop: space.xxl }}>Recent</Overline>
          <View style={{ gap: space.md, marginTop: space.lg }}>
            {sessions.slice(0, 8).map((session) => (
              <Pressable
                key={session.id}
                onPress={() => openDay(session.local_day)}
                accessibilityRole="button"
                accessibilityLabel={`${session.plan_days?.name ?? 'Session'} on ${format(new Date(session.started_at), 'd MMMM')}`}
              >
                <Card style={styles.recentRow}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Body style={styles.strong}>{session.plan_days?.name ?? 'Session'}</Body>
                    <Muted>
                      {format(new Date(session.started_at), 'EEE d MMM')}
                      {session.duration_s ? ` · ${Math.round(session.duration_s / 60)} min` : ''}
                      {session.rpe ? ` · RPE ${session.rpe}` : ''}
                    </Muted>
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <View style={{ gap: 2, flex: 1 }}>
    <Heading numberOfLines={1} adjustsFontSizeToFit>
      {value}
    </Heading>
    <Overline>{label}</Overline>
  </View>
);

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  dayCard: { marginTop: space.lg, gap: space.md },
  nextCard: { borderColor: colors.accent },
  cardHead: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  thumb: { width: 64, height: 64 },
  dayName: { ...type.heading },
  stats: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  strong: { ...type.body, fontWeight: '700' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  itemName: { ...type.small, flex: 1 },
  recentRow: { flexDirection: 'row', alignItems: 'center' },
});
