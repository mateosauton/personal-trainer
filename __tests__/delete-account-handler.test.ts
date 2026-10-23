import { deleteOwnAccount } from '../supabase/functions/delete-account/handler';

const api = () => ({ verify: jest.fn().mockResolvedValue('owner'),
  listPhotos: jest.fn().mockResolvedValue([]), removePhotos: jest.fn().mockResolvedValue(undefined),
  revokeSessions: jest.fn().mockResolvedValue(undefined), deleteUser: jest.fn().mockResolvedValue(undefined) });

it('rejects missing authentication and account mismatches before deleting anything', async () => {
  const backend = api();
  await expect(deleteOwnAccount(backend, '', { confirmation: 'DELETE', account_id: 'owner' })).rejects.toThrow('Authentication');
  await expect(deleteOwnAccount(backend, 'token', { confirmation: 'DELETE', account_id: 'foreign' })).rejects.toThrow('Account changed');
  expect(backend.deleteUser).not.toHaveBeenCalled();
});

it('removes only the verified user photos before revoking sessions and deleting the user', async () => {
  const backend = api();
  backend.listPhotos.mockResolvedValueOnce(['avatar.jpeg']).mockResolvedValueOnce([]);
  await expect(deleteOwnAccount(backend, 'token', { confirmation: 'DELETE', account_id: 'owner' })).resolves.toEqual({ deleted_account_id: 'owner' });
  expect(backend.removePhotos).toHaveBeenCalledWith(['owner/avatar.jpeg']);
  expect(backend.revokeSessions).toHaveBeenCalledWith('token');
  expect(backend.deleteUser).toHaveBeenCalledWith('owner');
  expect(backend.removePhotos.mock.invocationCallOrder[0]).toBeLessThan(backend.deleteUser.mock.invocationCallOrder[0]);
});

it('preserves the account when object deletion fails or a folder is unexpected', async () => {
  const backend = api();
  backend.listPhotos.mockResolvedValueOnce(['avatar.jpeg']);
  backend.removePhotos.mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(deleteOwnAccount(backend, 'token', { confirmation: 'DELETE', account_id: 'owner' })).rejects.toThrow('Storage unavailable');
  expect(backend.deleteUser).not.toHaveBeenCalled();
});

it('requires explicit confirmation and rejects unsafe object names', async () => {
  const backend = api();
  await expect(deleteOwnAccount(backend, 'token', { confirmation: 'yes', account_id: 'owner' })).rejects.toThrow('confirmation');
  backend.listPhotos.mockResolvedValueOnce(['../foreign/photo.jpeg']);
  await expect(deleteOwnAccount(backend, 'token', { confirmation: 'DELETE', account_id: 'owner' })).rejects.toThrow('Unexpected');
  expect(backend.deleteUser).not.toHaveBeenCalled();
});
