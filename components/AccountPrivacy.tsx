import { useState } from 'react';
import { Button, Card, Muted, Overline } from './ui';
import { confirm, notify } from '@/lib/alerts';
import { deleteAccount } from '@/lib/account-delete';
import { exportAccountData } from '@/lib/account-export';
import { space } from '@/lib/theme';

export function AccountPrivacy({ owner }: { owner: string }) {
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);
  const exportData = async () => {
    setBusy('export');
    try { await exportAccountData(owner, true); }
    catch (error) { notify('Could not export', error instanceof Error ? error.message : 'Please retry.'); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    if (!await confirm({ title: 'Permanently delete your account?',
      message: 'Your profile, plans, workouts and photos will be deleted. Saved workouts on this device will be removed. Export your data first if you want a copy. This cannot be undone.',
      confirmLabel: 'Delete account', destructive: true })) return;
    setBusy('delete');
    try { await deleteAccount(owner); }
    catch (error) { notify('Account deletion needs attention', error instanceof Error ? error.message : 'Please retry from Profile.'); }
    finally { setBusy(null); }
  };
  return <Card style={{ marginTop: space.lg, gap: space.md }}>
    <Overline>Your data</Overline>
    <Muted>Export your synced profile and workout history together with saved updates and recovery archives on this device. Photo files are not included.</Muted>
    <Button title="Export account data" variant="surface" onPress={exportData} loading={busy === 'export'} disabled={busy !== null} />
    <Button title="Delete account" variant="ghost" onPress={remove} loading={busy === 'delete'} disabled={busy !== null} />
  </Card>;
}
