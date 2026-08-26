import { useFocusEffect } from 'expo-router';
import { format } from 'date-fns';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Body, Card, Display, Muted, Overline, Screen } from '@/components/ui';
import { useUserId } from '@/lib/auth';
import { getRecentSessions } from '@/lib/db/queries';
import { colors, space, type } from '@/lib/theme';

interface Row {
  id: string;
  started_at: string;
  duration_s: number | null;
  rpe: number | null;
  plan_days: { name: string; focus: string } | null;
}

export default function History() {
  const userId = useUserId();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getRecentSessions(userId)
        .then((data) => {
          if (!cancelled) setRows(data as unknown as Row[]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [userId]),
  );

  if (loading) {
    return (
      <Screen scroll={false} style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Overline>History</Overline>
      <Display style={{ marginTop: space.sm }}>
        {rows.length} {rows.length === 1 ? 'session' : 'sessions'}
      </Display>

      {rows.length === 0 ? (
        <Muted style={{ marginTop: space.lg }}>
          Finish a session and it will show up here.
        </Muted>
      ) : (
        <View style={{ gap: space.md, marginTop: space.xl }}>
          {rows.map((row) => (
            <Card key={row.id} style={styles.row}>
              <View style={{ flex: 1, gap: 2 }}>
                <Body style={styles.name}>{row.plan_days?.name ?? 'Session'}</Body>
                <Muted>
                  {format(new Date(row.started_at), 'EEE d MMM')}
                  {row.duration_s ? ` · ${Math.round(row.duration_s / 60)} min` : ''}
                  {row.rpe ? ` · RPE ${row.rpe}` : ''}
                </Muted>
              </View>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  name: { ...type.body, fontWeight: '700' },
});
