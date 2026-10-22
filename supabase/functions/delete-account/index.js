import { createClient } from 'npm:@supabase/supabase-js@2.109.0';
import { deleteOwnAccount } from './handler.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1] ?? '';
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: 'Account deletion is not configured.' }, 503);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const result = await deleteOwnAccount({
      verify: async jwt => {
        const { data, error } = await admin.auth.getUser(jwt);
        if (error) return null;
        return data.user?.id ?? null;
      },
      listPhotos: async owner => {
        const { data, error } = await admin.storage.from('avatars').list(owner, { limit: 100 });
        if (error) throw new Error('Could not list photos. Retry deletion.');
        if (data.some(object => !object.id)) throw new Error('Unexpected photo folder. Contact support.');
        return data.map(object => object.name);
      },
      removePhotos: async paths => {
        const { error } = await admin.storage.from('avatars').remove(paths);
        if (error) throw new Error('Could not remove photos. Retry deletion.');
      },
      revokeSessions: async jwt => {
        const { error } = await admin.auth.admin.signOut(jwt, 'global');
        if (error) throw new Error('Could not revoke sessions. Retry deletion.');
      },
      deleteUser: async owner => {
        const { error } = await admin.auth.admin.deleteUser(owner);
        if (error) throw new Error('Could not delete the account. Sign in again to retry.');
      },
    }, token, await request.json());
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Account deletion failed. Retry from Profile.';
    return json({ error: message }, message === 'Authentication required.' ? 401 : 400);
  }
});
