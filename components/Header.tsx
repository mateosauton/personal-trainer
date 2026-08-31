import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Muted, Overline, Title } from '@/components/ui';
import { colors, radius, space, type } from '@/lib/theme';

/** "MS" from "Mateo Sauton"; a single letter is fine, an empty string is not. */
function initials(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

/**
 * Who you are, top-left, and a greeting beside it. The avatar is the way into
 * the profile now that it is no longer a tab — identity in the corner, the way
 * every app the user already has one works.
 */
export function Header({
  name,
  avatarUrl,
  subtitle,
}: {
  name: string | null;
  avatarUrl: string | null;
  subtitle?: string;
}) {
  const router = useRouter();

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => router.push('/profile')}
        accessibilityRole="button"
        accessibilityLabel="Open your profile"
        style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.75 }]}
      >
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatarImage} contentFit="cover" />
        ) : (
          <Overline style={styles.initials}>{initials(name)}</Overline>
        )}
      </Pressable>

      <View style={styles.text}>
        <Title numberOfLines={1} style={styles.greeting}>
          Welcome {name?.trim() || 'back'}!
        </Title>
        {subtitle ? <Muted numberOfLines={1}>{subtitle}</Muted> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  initials: { ...type.body, fontWeight: '800', color: colors.text, letterSpacing: 0.5 },
  text: { flex: 1, gap: 2 },
  greeting: { ...type.title, fontSize: 24, lineHeight: 28 },
});
