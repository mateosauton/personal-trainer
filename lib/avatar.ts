import { supabase } from './db/supabase';

/** Legacy public URLs are accepted only as object references, never rendered. */
export function avatarPath(value: string | null, owner: string): string | null {
  if (!value) return null;
  let path = value;
  if (value.includes('://')) {
    try {
      const url = new URL(value);
      const marker = '/storage/v1/object/';
      if (!url.pathname.startsWith(marker)) return null;
      const match = url.pathname.slice(marker.length).match(/^(?:public|sign|authenticated)\/avatars\/(.+)$/);
      if (!match) return null;
      path = decodeURIComponent(match[1]);
    } catch { return null; }
  }
  return path.startsWith(`${owner}/`) && path.split('/').length === 2
    && !path.split('/').some(part => !part || part === '.' || part === '..')
    && !/[\\?#\u0000-\u001f]/.test(path) ? path : null;
}

export async function resolveAvatar(value: string | null, owner: string): Promise<string | null> {
  const path = avatarPath(value, owner);
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path, 300);
    return error ? null : data?.signedUrl ?? null;
  } catch { return null; }
}

export async function storeAvatar(owner: string, uri: string): Promise<string> {
  const response = await fetch(uri);
  const contentType = response.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  const extensions: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
  const extension = extensions[contentType];
  if (!extension) throw new Error('Choose a JPEG, PNG, WebP or HEIC photo.');
  const body = await response.arrayBuffer();
  if (body.byteLength > 10 * 1024 * 1024) throw new Error('Choose a photo smaller than 10 MB.');
  const path = `${owner}/avatar.${extension}`;
  const { error } = await supabase.storage.from('avatars').upload(path, body, { contentType, upsert: true });
  if (error) throw error;
  return path;
}
