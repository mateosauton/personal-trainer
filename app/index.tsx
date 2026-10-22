import { Redirect } from 'expo-router';

import { useAuth } from '@/lib/auth';
import { profileGate } from '@/lib/auth-gate';

/**
 * Keep the public root route separate from the authenticated tabs. On the web
 * the router resolves `/` before protected navigator state has settled, so
 * rendering the tabs directly here can call authenticated hooks without a
 * session and blank the page.
 */
export default function Index() {
  const { session, loading, processingAuthLink, recoveringPassword, profileState } = useAuth();

  if (loading || processingAuthLink) return null;
  if (!session) return <Redirect href="/sign-in" />;
  if (recoveringPassword) return <Redirect href="/reset-password" />;
  const gate = profileGate(true, profileState);
  if (gate === 'loading' || gate === 'error') return null;
  return <Redirect href={gate === 'ready' ? '/(tabs)' : '/onboarding'} />;
}
