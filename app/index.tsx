import { Redirect } from 'expo-router';

import { useAuth } from '@/lib/auth';

/**
 * Keep the public root route separate from the authenticated tabs. On the web
 * the router resolves `/` before protected navigator state has settled, so
 * rendering the tabs directly here can call authenticated hooks without a
 * session and blank the page.
 */
export default function Index() {
  const { session, loading } = useAuth();

  if (loading) return null;
  return <Redirect href={session ? '/(tabs)' : '/sign-in'} />;
}
