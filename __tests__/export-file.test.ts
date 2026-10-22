import { cleanupExports, deliverExport } from '@/lib/export-file';
import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
jest.mock('expo-crypto', () => ({ randomUUID: () => 'unique' }));
const currentAccount = jest.fn(async () => {});
const mockFile = { uri: 'file:///cache/export.json', create: jest.fn(), write: jest.fn(), delete: jest.fn() };
const mockDirectory = { exists: true, create: jest.fn(), list: jest.fn((): unknown[] => []) };
jest.mock('expo-file-system', () => ({ File: jest.fn(() => mockFile), Directory: jest.fn(() => mockDirectory), Paths: { cache: 'file:///cache/' } }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  mockDirectory.list.mockReturnValue([]);
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue();
});
it('shares a JSON file and removes the temporary copy after dismissal', async () => {
  await deliverExport('{"profile":{}}', 'office-gym-data.json', currentAccount);
  expect(File).toHaveBeenCalledWith(mockDirectory, expect.stringMatching(/^\d+-unique-office-gym-data.json$/));
  expect(mockFile.write).toHaveBeenCalledWith('{"profile":{}}');
  expect(Sharing.shareAsync).toHaveBeenCalledWith(mockFile.uri, expect.objectContaining({ mimeType: 'application/json' }));
  expect(mockFile.delete).toHaveBeenCalledTimes(1);
});
it('removes the cached private data when sharing fails', async () => {
  jest.mocked(Sharing.shareAsync).mockRejectedValue(new Error('sharing failed'));
  await expect(deliverExport('{}', 'data.json', currentAccount)).rejects.toThrow('sharing failed');
  expect(mockFile.delete).toHaveBeenCalledTimes(1);
});
it('does not create a private file when sharing is unavailable', async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
  await expect(deliverExport('{}', 'data.json', currentAccount)).rejects.toThrow('File sharing is unavailable');
  expect(File).not.toHaveBeenCalled();
});
it('checks account ownership after asynchronous sharing availability and before creating a file', async () => {
  currentAccount.mockRejectedValueOnce(new Error('Account changed'));
  await expect(deliverExport('{}', 'data.json', currentAccount)).rejects.toThrow('Account changed');
  expect(File).not.toHaveBeenCalled();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});
it('keeps Android attachments available for delayed receiving apps', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  await deliverExport('{}', 'data.json', currentAccount);
  expect(mockFile.delete).not.toHaveBeenCalled();
});
it('removes only expired files during later cleanup', () => {
  const expired = Object.assign(Object.create(File.prototype), { name: `${Date.now()-86400001}-old.json`, delete: jest.fn() });
  const recent = Object.assign(Object.create(File.prototype), { name: `${Date.now()}-recent.json`, delete: jest.fn() });
  mockDirectory.list.mockReturnValue([expired,recent]);
  cleanupExports();
  expect(expired.delete).toHaveBeenCalledTimes(1);
  expect(recent.delete).not.toHaveBeenCalled();
});
