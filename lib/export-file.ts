import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

const retentionMs = 24 * 60 * 60 * 1000;
function exportDirectory() { return new Directory(Paths.cache, 'account-exports'); }

/** Expired Android attachments are removed on startup and before later exports. */
export function cleanupExports(): void {
  const directory = exportDirectory();
  if (!directory.exists) return;
  for (const file of directory.list()) {
    const match = /^(\d+)-/.exec(file.name);
    if (file instanceof File && match && Date.now() - Number(match[1]) > retentionMs) file.delete();
  }
}

export async function deliverExport(json: string, filename: string, assertCurrentAccount: () => Promise<void>): Promise<void> {
  if (!await Sharing.isAvailableAsync()) throw new Error('File sharing is unavailable on this device.');
  await assertCurrentAccount();
  cleanupExports();
  const directory = exportDirectory();
  directory.create({ idempotent: true, intermediates: true });
  const file = new File(directory, `${Date.now()}-${Crypto.randomUUID()}-${filename}`);
  file.create();
  try {
    file.write(json);
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Export synced data' });
  } finally {
    // Android's chooser result does not guarantee the receiver consumed its URI.
    // Retain the attachment until a later cleanup rather than racing that reader.
    if (Platform.OS !== 'android') file.delete();
  }
}
