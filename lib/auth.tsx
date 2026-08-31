import type { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { completeAuthFromUrl } from './deep-link';
import { getProfile } from './db/queries';
import { supabase } from './db/supabase';
import type { ProfileState } from './auth-gate';
import type { Profile } from './types';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  profileState: ProfileState;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const profileCacheKey = (userId: string) => `office-gym.profile.${userId}`;

const cachedProfile = async (userId: string): Promise<Profile | null> => {
  const raw = await AsyncStorage.getItem(profileCacheKey(userId));
  if (!raw) return null;
  try { return JSON.parse(raw) as Profile; } catch { return null; }
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profileState, setProfileState] = useState<ProfileState>({ status: 'loading' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setProfileState({ status: 'ready', profile: null });
        setLoading(false);
      }
    });

    // An email confirmation link opens the app with the tokens attached.
    // onAuthStateChange picks the session up once completeAuthFromUrl sets it.
    Linking.getInitialURL().then((url) => {
      if (url) completeAuthFromUrl(url);
    });
    const linkSub = Linking.addEventListener('url', ({ url }) => {
      completeAuthFromUrl(url);
    });

    return () => {
      sub.subscription.unsubscribe();
      linkSub.remove();
    };
  }, []);

  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    setProfileState({ status: 'loading' });
    getProfile(userId)
      .then((p) => {
        if (!cancelled) {
          setProfileState({ status: 'ready', profile: p });
          if (p) void AsyncStorage.setItem(profileCacheKey(userId), JSON.stringify(p));
        }
      })
      .catch(async (error: unknown) => {
        const cached = await cachedProfile(userId);
        if (!cancelled) setProfileState(cached
          ? { status: 'ready', profile: cached }
          : { status: 'error', error: error instanceof Error ? error : new Error('Could not load profile') });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile: profileState.status === 'ready' ? profileState.profile : null,
      profileState,
      loading,
      refreshProfile: async () => {
        if (!userId) return;
        setProfileState({ status: 'loading' });
        try {
          const profile = await getProfile(userId);
          setProfileState({ status: 'ready', profile });
          if (profile) await AsyncStorage.setItem(profileCacheKey(userId), JSON.stringify(profile));
        } catch (error) {
          setProfileState({ status: 'error', error: error instanceof Error ? error : new Error('Could not load profile') });
          throw error;
        }
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, profileState, loading, userId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** The user id, asserted. Only call from screens behind the auth gate. */
export function useUserId(): string {
  const { session } = useAuth();
  if (!session) throw new Error('No session');
  return session.user.id;
}
