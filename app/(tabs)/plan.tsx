import { format } from 'date-fns';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Calendar } from '@/components/Calendar';
import { GymRoutineCard } from '@/components/GymRoutineCard';
import { PlanExpansion } from '@/components/PlanExpansion';
import { Body, Button, Card, Display, Heading, Muted, Overline, Screen } from '@/components/ui';
import { useAuth, useUserId } from '@/lib/auth';
import { getExercise } from '@/lib/catalog';
import { getSetLogsForSessions } from '@/lib/db/queries';
import { estimateDay, planScreenSummary, planScreenTitle, sessionCardMeta, sessionCardTitle } from '@/lib/plan/estimate';
import { isGymRoutine } from '@/lib/plan/gym-routine';
import { sessionTotals, type Totals } from '@/lib/stats';
import { colors, space, type } from '@/lib/theme';
import { formatWeight } from '@/lib/units';
import { useDashboard, type HistorySession } from '@/lib/useDashboard';

/**
 * Plan opens on the session list (Figma PL03 / PL04). A day heading expands
 * its blocks; Start and View both open that next session. The calendar and
 * the PPL switch stay on the same screen, below the list.
 */
export default function PlanTab() {
  const userId = useUserId();
  const { profile } = useAuth();
  const router = useRouter();
  const bodyweightKg = profile?.bodyweight_kg ?? null;
  const { plan, nextDay, sessions, trainedDays, today, homeTimezone, loading, usingCachedPlan, error, reload } = useDashboard(
    userId,
    bodyweightKg,
    profile?.home_timezone,
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
        <GymRoutineCard userId={userId} onActivated={reload} />
      </Screen>
    );
  }

  const routine = isGymRoutine(plan);
  const logged = usingCachedPlan || error ? null : sessions.length;
  const openSession = (dayId: string) => router.push(`/session/${dayId}`);

  return (
    <Screen ref={scrollRef}>
      <Overline>Office Gym</Overline>
      <Display style={{ marginTop: space.sm }}>{planScreenTitle(routine)}</Display>
      <Muted style={{ marginTop: space.sm }}>
        {planScreenSummary(plan.days.length, plan.weeks, logged, routine)}
      </Muted>
      {routine ? (
        <Muted style={{ marginTop: space.sm }}>
          47 min target · Push A → Pull A → Legs A → Push B → Pull B → Legs B.
          Take rest days between sessions.
        </Muted>
      ) : null}
      {(usingCachedPlan || error) && (
        <Card style={{ marginTop: space.lg, gap: space.sm }}>
          <Muted>{usingCachedPlan
            ? 'Using your saved plan. History will load when you reconnect.'
            : 'Your plan is ready. Training history could not be loaded.'}</Muted>
          <Button title="Retry connection" variant="ghost" onPress={reload} />
        </Card>
      )}

      <View style={{ gap: space.md, marginTop: space.xl }} testID="plan-sessions">
        {plan.days.map((day) => {
          const isNext = day.id === nextDay?.id;
          const open = expanded === day.id;
          const estimate = estimateDay(day);
          const title = sessionCardTitle(day.name, day.day_index, isNext);

          return (
            <Card key={day.id}>
              <Pressable
                onPress={() => setExpanded((current) => current === day.id ? null : day.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${title} details`}
                style={{ gap: 2 }}
              >
                <Body style={styles.dayName}>{title}</Body>
                <Muted>{sessionCardMeta(estimate.minutes, estimate.blocks, estimate.sets)}</Muted>
              </Pressable>

              <PlanExpansion expanded={open}>
                <View style={{ gap: space.lg, paddingTop: space.lg }}>
                  {day.blocks.map((block) => (
                    <View key={block.id} style={{ gap: space.xs }}>
                      <Overline>{block.title}</Overline>
                      <Muted>
                        {block.duration_seconds != null ? `${formatBlockTime(block.duration_seconds)} · ` : ''}
                        {block.duration_seconds != null && block.kind !== 'warmup'
                          ? block.kind === 'straight' ? 'Straight sets · timed recovery'
                            : `${block.kind === 'superset' ? 'Superset' : 'Circuit'} · ${block.rounds} ${block.rounds === 1 ? 'round' : 'rounds'} · timed recovery`
                          : block.kind === 'warmup'
                          ? 'Move through once'
                          : block.kind === 'straight'
                            ? `Straight sets · rest ${block.rest_seconds}s`
                            : `${block.kind === 'superset' ? 'Superset' : 'Circuit'} · ${block.rounds} rounds · rest ${block.rest_seconds}s`}
                      </Muted>
                      {block.items.map((item) => (
                        <View key={item.id} style={styles.itemRow}>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Body style={styles.itemName}>
                              {getExercise(item.exercise_id)?.name ?? item.exercise_id}
                            </Body>
                            {item.notes ? <Muted>{item.notes}</Muted> : null}
                          </View>
                          <Muted>
                            {item.seconds
                              ? `${block.kind === 'straight' ? item.sets : block.rounds} × ${item.seconds}s`
                              : `${block.kind === 'straight' ? item.sets : block.rounds} × ${item.reps_low}${item.reps_high !== item.reps_low ? `–${item.reps_high}` : ''}`}
                          </Muted>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </PlanExpansion>
            </Card>
          );
        })}
      </View>

      {nextDay ? (
        <View style={{ marginTop: space.xl, gap: space.xs }}>
          <Button title="Start this session" onPress={() => openSession(nextDay.id)} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View session"
            onPress={() => openSession(nextDay.id)}
            style={styles.textAction}
          >
            <Muted>View session</Muted>
          </Pressable>
        </View>
      ) : null}
      {routine ? null : <GymRoutineCard userId={userId} onActivated={reload} variant="link" />}

      {!usingCachedPlan && !error && <View
        style={{ marginTop: space.xl }}
        onLayout={(e) => {
          calendarY.current = e.nativeEvent.layout.y;
        }}
        testID="plan-calendar"
      >
        <Calendar today={today} trainedDays={trainedDays} selected={selected} onSelect={setSelected} />
      </View>}

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

      <Muted style={{ marginTop: space.sm }}>Calendar and history use {homeTimezone}, including while travelling.</Muted>

      {sessions.length > 0 ? (
        <>
          <Overline style={{ marginTop: space.xxl }}>Recent</Overline>
          <View style={{ gap: space.md, marginTop: space.lg }}>
            {sessions.slice(0, 8).map((session) => (
              <Pressable
                key={session.id}
                onPress={() => openDay(session.local_day)}
                accessibilityRole="button"
                accessibilityLabel={`${session.plan_days?.name ?? 'Session'} on ${format(new Date(`${session.local_day}T12:00:00`), 'd MMMM')}`}
              >
                <Card style={styles.recentRow}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Body style={styles.strong}>{session.plan_days?.name ?? 'Session'}</Body>
                    <Muted>
                      {format(new Date(`${session.local_day}T12:00:00`), 'EEE d MMM')}
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

function formatBlockTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} min`;
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
  dayName: { ...type.heading },
  textAction: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  strong: { ...type.body, fontWeight: '700' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  itemName: { ...type.small, flex: 1 },
  recentRow: { flexDirection: 'row', alignItems: 'center' },
});
