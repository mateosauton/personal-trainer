const mockBucket = { createSignedUrl: jest.fn(), upload: jest.fn() };
jest.mock('@/lib/db/supabase', () => ({ supabase: {
  storage: { from: jest.fn(() => mockBucket) },
} }));
import { avatarPath, resolveAvatar, storeAvatar } from '@/lib/avatar';

beforeEach(() => jest.clearAllMocks());

it('accepts only this account path, including known legacy Storage URLs', () => {
  expect(avatarPath('owner/avatar.jpeg', 'owner')).toBe('owner/avatar.jpeg');
  expect(avatarPath('https://project.supabase.co/storage/v1/object/public/avatars/owner/avatar.jpeg?v=1', 'owner'))
    .toBe('owner/avatar.jpeg');
  expect(avatarPath('foreign/avatar.jpeg', 'owner')).toBeNull();
  expect(avatarPath('owner/../foreign/avatar.jpeg', 'owner')).toBeNull();
  expect(avatarPath('https://tracking.test/photo.jpeg', 'owner')).toBeNull();
});

it('uses a short-lived signed URL and hides a photo if access fails', async () => {
  mockBucket.createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: 'signed' }, error: null });
  await expect(resolveAvatar('owner/avatar.jpeg', 'owner')).resolves.toBe('signed');
  expect(mockBucket.createSignedUrl).toHaveBeenCalledWith('owner/avatar.jpeg', 300);
  mockBucket.createSignedUrl.mockResolvedValueOnce({ data: null, error: new Error('offline') });
  await expect(resolveAvatar('owner/avatar.jpeg', 'owner')).resolves.toBeNull();
});

it('stores an owner path rather than a publicly reusable URL', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = jest.fn().mockResolvedValue({ headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new ArrayBuffer(2) });
  mockBucket.upload.mockResolvedValue({ error: null });
  try {
    await expect(storeAvatar('owner', 'local-image')).resolves.toBe('owner/avatar.jpeg');
    expect(mockBucket.upload).toHaveBeenCalledWith('owner/avatar.jpeg', expect.any(ArrayBuffer), { contentType: 'image/jpeg', upsert: true });
  } finally { globalThis.fetch = originalFetch; }
});
