import type { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { completeAuthFromUrl, isRecoveryLink } from './deep-link';
import { getProfile } from './db/queries';
import { supabase } from './db/supabase';
import type { ProfileState } from './auth-gate';
import type { Profile } from './types';
import { setSyncAccount, startOutboxSync } from './session/sync';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  profileState: ProfileState;
  loading: boolean;
  recoveringPassword: boolean;
  processingAuthLink: boolean;
  authError: Error | null;
  retrySession: () => Promise<void>;
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
  const [recoveringPassword, setRecoveringPassword] = useState(false);
  const [processingAuthLink, setProcessingAuthLink] = useState(false);
  const [authError, setAuthError] = useState<Error | null>(null);
  const authEpoch = useRef(0);
  const currentUser = useRef<string | null>(null);

  const applySession = useCallback((next: Session | null) => {
    const owner = next?.user.id ?? null;
    setSyncAccount(owner);
    if (owner !== currentUser.current) {
      currentUser.current = owner;
      setProfileState(owner ? { status: 'loading' } : { status: 'ready', profile: null });
    }
    setSession(next);
    setLoading(false);
  }, []);

  const retrySession = useCallback(async () => {
    const epoch = authEpoch.current;
    setLoading(true);
    setAuthError(null);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (authEpoch.current === epoch) applySession(data.session);
    } catch (error) {
      if (authEpoch.current === epoch) {
        setAuthError(error instanceof Error ? error : new Error('Could not restore your session.'));
        setLoading(false);
      }
    }
  }, [applySession]);

  useEffect(() => {
    void retrySession();
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      authEpoch.current += 1;
      setAuthError(null);
      if (event === 'PASSWORD_RECOVERY') setRecoveringPassword(true);
      if (!next) setRecoveringPassword(false);
      applySession(next);
    });

    const handleLink = async (url: string) => {
      setProcessingAuthLink(true);
      try {
        const recovery = isRecoveryLink(url);
        const completed = await completeAuthFromUrl(url);
        if (recovery && !completed) throw new Error('Open the password reset link from your email.');
        if (completed) setRecoveringPassword(recovery);
      } catch (error) {
        setRecoveringPassword(false);
        setAuthError(error instanceof Error ? error : new Error('Could not open the sign-in link.'));
        setLoading(false);
      } finally { setProcessingAuthLink(false); }
    };
    let linkWork = Promise.resolve();
    let receivedLiveLink = false;
    const queueLink = (url: string) => { linkWork = linkWork.then(() => handleLink(url)); };
    Linking.getInitialURL().then((url) => {
      if (url && !receivedLiveLink) queueLink(url);
    }).catch((error) => {
      setAuthError(error instanceof Error ? error : new Error('Could not open the sign-in link.'));
      setLoading(false);
    });
    const linkSub = Linking.addEventListener('url', ({ url }) => { receivedLiveLink = true; queueLink(url); });

    return () => {
      authEpoch.current += 1;
      sub.subscription.unsubscribe();
      linkSub.remove();
    };
  }, [applySession, retrySession]);

  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    return startOutboxSync(userId);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    setProfileState({ status: 'loading' });
    getProfile(userId)
      .then((p) => {
        if (!cancelled) {
          setProfileState({ status: 'ready', profile: p });
          if (p) void AsyncStorage.setItem(profileCacheKey(userId), JSON.stringify(p)).catch(() => undefined);
        }
      })
      .catch(async (error: unknown) => {
        let cached: Profile | null = null;
        try { cached = await cachedProfile(userId); } catch { /* Keep the server error recoverable. */ }
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
      recoveringPassword,
      processingAuthLink,
      authError,
      retrySession,
      refreshProfile: async () => {
        if (!userId || currentUser.current !== userId) return;
        setProfileState({ status: 'loading' });
        try {
          const profile = await getProfile(userId);
          if (currentUser.current !== userId) return;
          setProfileState({ status: 'ready', profile });
          if (profile) await AsyncStorage.setItem(profileCacheKey(userId), JSON.stringify(profile));
        } catch (error) {
          if (currentUser.current === userId) setProfileState({ status: 'error', error: error instanceof Error ? error : new Error('Could not load profile') });
          throw error;
        }
      },
      signOut: async () => {
        setSyncAccount(null);
        const { error } = await supabase.auth.signOut();
        if (error) {
          const { data } = await supabase.auth.getSession();
          setSyncAccount(data.session?.user.id ?? null);
          throw error;
        }
      },
    }),
    [session, profileState, loading, userId, recoveringPassword, processingAuthLink, authError, retrySession],
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
