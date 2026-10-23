export interface DeletionBackend {
  verify(token: string): Promise<string | null>;
  listPhotos(owner: string): Promise<string[]>;
  removePhotos(paths: string[]): Promise<void>;
  revokeSessions(token: string): Promise<void>;
  deleteUser(owner: string): Promise<void>;
}

/** The verified access token selects the account. Request data cannot select it. */
export async function deleteOwnAccount(api: DeletionBackend, token: string, body: unknown) {
  if (!token) throw new Error('Authentication required.');
  const owner = await api.verify(token);
  if (!owner) throw new Error('Authentication required.');
  if (!body || typeof body !== 'object' || !('confirmation' in body) || body.confirmation !== 'DELETE')
    throw new Error('Explicit DELETE confirmation required.');
  if (!('account_id' in body) || body.account_id !== owner) throw new Error('Account changed.');
  // Always fetch the first page after deletion, so shifting offsets skip no files.
  for (let page = 0; ; page++) {
    if (page >= 1000) throw new Error('Photo cleanup limit reached. Retry deletion.');
    const names = await api.listPhotos(owner);
    if (!names.length) break;
    if (names.some(name => !name || name === '.' || name === '..' || /[\\/\u0000-\u001f]/.test(name)))
      throw new Error('Unexpected photo object. Contact support before retrying.');
    await api.removePhotos(names.map(name => `${owner}/${name}`));
  }
  await api.revokeSessions(token);
  await api.deleteUser(owner);
  return { deleted_account_id: owner };
}
