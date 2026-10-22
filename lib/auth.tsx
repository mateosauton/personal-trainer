import type { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

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
  authError: string | null;
  clearAuthError: () => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const profileCacheKey = (userId: string) => `office-gym.profile.${userId}`;

const cachedProfile = async (userId: string): Promise<Profile | null> => {
  try {
    const raw = await AsyncStorage.getItem(profileCacheKey(userId));
    return raw ? JSON.parse(raw) as Profile : null;
  } catch { return null; }
};

const cacheProfile = async (profile: Profile) => {
  try {
    await AsyncStorage.setItem(profileCacheKey(profile.id), JSON.stringify(profile));
  } catch { /* A cache failure must not discard a profile loaded from the server. */ }
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const currentSession = useRef<Session | null>(null);
  const [profileState, setProfileState] = useState<ProfileState>({ status: 'loading' });
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const clearAuthError = useCallback(() => setAuthError(null), []);

  useEffect(() => {
    let active = true;
    let authEvents = 0;
    const applySession = (next: Session | null) => {
      if (!active) return;
      if (next?.user.id !== currentSession.current?.user.id) {
        setProfileState(next ? { status: 'loading' } : { status: 'ready', profile: null });
        setLoading(next != null);
      }
      currentSession.current = next;
      if (!next) {
        setProfileState({ status: 'ready', profile: null });
        setLoading(false);
      }
      setSession(next);
    };
    const reportAuthError = (error: unknown) => {
      if (!active) return;
      setAuthError(error instanceof Error ? error.message : 'Could not complete sign-in. Please try again.');
      if (!currentSession.current) setLoading(false);
    };

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active || authEvents > 0) return;
      if (error) throw error;
      applySession(data.session);
    }).catch((error: unknown) => {
      if (!active || authEvents > 0) return;
      applySession(null);
      reportAuthError(error);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      authEvents += 1;
      applySession(next);
      if (next && active) setAuthError(null);
    });

    // Email and social sign-in callbacks establish the session through Supabase.
    void Linking.getInitialURL().then(async (url) => {
      if (url && active) await completeAuthFromUrl(url);
    }).catch(reportAuthError);
    const linkSub = Linking.addEventListener('url', ({ url }) => {
      void completeAuthFromUrl(url).catch(reportAuthError);
    });

    return () => {
      active = false;
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
        if (!cancelled && currentSession.current?.user.id === userId) {
          setProfileState({ status: 'ready', profile: p });
          if (p) void cacheProfile(p);
        }
      })
      .catch(async (error: unknown) => {
        const cached = await cachedProfile(userId);
        if (!cancelled && currentSession.current?.user.id === userId) setProfileState(cached
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
      authError,
      clearAuthError,
      refreshProfile: async () => {
        if (!userId) return;
        setProfileState({ status: 'loading' });
        try {
          const profile = await getProfile(userId);
          if (currentSession.current?.user.id !== userId) return;
          setProfileState({ status: 'ready', profile });
          if (profile) await cacheProfile(profile);
        } catch (error) {
          if (currentSession.current?.user.id !== userId) return;
          setProfileState({ status: 'error', error: error instanceof Error ? error : new Error('Could not load profile') });
          throw error;
        }
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, profileState, loading, authError, clearAuthError, userId],
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
