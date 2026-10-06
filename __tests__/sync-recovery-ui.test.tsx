import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SyncRecovery } from '@/components/SyncRecovery';
const mockStatus = jest.fn(),
  mockRetry = jest.fn(), mockConflicts = jest.fn(), mockReview = jest.fn(), mockResolve = jest.fn();
jest.mock('@/lib/session/sync', () => ({
  getSyncStatus: (...args: unknown[]) => mockStatus(...args),
  retrySync: (...args: unknown[]) => mockRetry(...args),
  getSetConflicts: (...args: unknown[]) => mockConflicts(...args),
  reviewSetConflict: (...args: unknown[]) => mockReview(...args),
  resolveSetConflict: (...args: unknown[]) => mockResolve(...args),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockRetry.mockResolvedValue(undefined);
  mockConflicts.mockReset().mockResolvedValue([]);
  mockReview.mockReset(); mockResolve.mockReset().mockResolvedValue(undefined);
});
it('offers retry for preserved failed writes and removes the notice after successful replay', async () => {
  mockStatus.mockResolvedValue({ ownerId: 'A', pending: 0, rejected: 1 });
  const screen = render(<SyncRecovery userId="A" />);
  await waitFor(() =>
    expect(
      screen.getByText(
        '1 workout update needs attention. Your saved data is preserved.',
      ),
    ).toBeTruthy(),
  );
  mockStatus.mockResolvedValue({ ownerId: 'A', pending: 0, rejected: 0 });
  fireEvent.press(screen.getByText('Retry workout sync'));
  await waitFor(() => expect(mockRetry).toHaveBeenCalledWith('A'));
  await waitFor(() =>
    expect(screen.queryByText('Retry workout sync')).toBeNull(),
  );
});
it('ignores a delayed prior account status', async () => {
  let resolve!: (value: unknown) => void;
  mockStatus
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue({ ownerId: 'B', pending: 0, rejected: 0 });
  const screen = render(<SyncRecovery userId="A" />);
  screen.rerender(<SyncRecovery userId="B" />);
  await act(async () => {
    resolve({ ownerId: 'A', pending: 2, rejected: 1 });
  });
  expect(screen.queryByText('Retry workout sync')).toBeNull();
});
it('shows a recoverable error when saved sync state cannot be read', async () => {
  mockStatus.mockRejectedValue(new Error('Invalid queue'));
  const screen = render(<SyncRecovery userId="A" />);
  await waitFor(() =>
    expect(
      screen.getByText(
        'Could not read workout sync. Your saved data is preserved.',
      ),
    ).toBeTruthy(),
  );
  expect(screen.getByText('Retry workout sync')).toBeTruthy();
});

const write = { id: 'set-id', ownerId: 'A', sessionId: 'session-id', origin: 'origin', revision: 1,
  expectedVersion: 0, eventAt: '2026-10-06T10:00:00Z',
  set: { plan_item_id: 'item', exercise_id: 'press', set_index: 1, reps: 8, weight_kg: 60,
    is_bodyweight: false, added_load_kg: 0, rpe: null } };
const blocked = { write, code: 'PT409' };
const review = { ...blocked, ownerId: 'A', server: { serverVersion: 4,
  set: { ...write.set, reps: 12, weight_kg: 65 }, eventAt: '2026-10-06T11:00:00Z' } };
async function renderConflict(code = 'PT409') {
  mockStatus.mockResolvedValue({ ownerId: 'A', pending: 0, rejected: 1 });
  mockConflicts.mockResolvedValue([{ ...blocked, code }]);
  mockReview.mockResolvedValue({ ...review, code });
  const screen = render(<SyncRecovery userId="A" />);
  fireEvent.press(await screen.findByText('Review press set 1'));
  await screen.findByText('Saved: 8 reps · 60 kg');
  return screen;
}
it.each(['Keep saved set', 'Use server set'])('shows both values and requires the explicit %s choice', async title => {
  const screen = await renderConflict();
  expect(screen.getByText('Server: 12 reps · 65 kg')).toBeTruthy();
  expect(mockResolve).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText(title));
  await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('A', review,
    title === 'Keep saved set' ? 'saved' : 'server'));
});
it('lets the user cancel without resolving or dropping either copy', async () => {
  const screen = await renderConflict(); fireEvent.press(screen.getByText('Close review'));
  expect(screen.queryByText('Saved: 8 reps · 60 kg')).toBeNull();
  expect(mockResolve).not.toHaveBeenCalled();
});
it('keeps a failed choice recoverable and asks for a fresh review', async () => {
  const screen = await renderConflict(); mockResolve.mockRejectedValue(new Error('The saved set changed. Review the latest value.'));
  fireEvent.press(screen.getByText('Keep saved set'));
  await screen.findByText('The saved set changed. Review the latest value.');
  expect(screen.queryByText('Use server set')).toBeNull();
  expect(await screen.findByText('Review press set 1')).toBeTruthy();
});
it('shows finalized values without offering a replacement', async () => {
  const screen = await renderConflict('PT410');
  expect(screen.queryByText('Keep saved set')).toBeNull();
  expect(screen.queryByText('Use server set')).toBeNull();
  expect(screen.getByText('This workout is finalized. Your saved edit is preserved for review.')).toBeTruthy();
});
it('ignores a late conflict review from a prior account', async () => {
  mockStatus.mockResolvedValue({ ownerId: 'A', pending: 0, rejected: 1 });
  mockConflicts.mockResolvedValue([blocked]); let release!: (value: unknown) => void;
  mockReview.mockImplementation(() => new Promise(done => { release = done; }));
  const screen = render(<SyncRecovery userId="A" />);
  fireEvent.press(await screen.findByText('Review press set 1'));
  mockStatus.mockResolvedValue({ ownerId: 'B', pending: 0, rejected: 0 }); mockConflicts.mockResolvedValue([]);
  screen.rerender(<SyncRecovery userId="B" />);
  await act(async () => { release(review); });
  expect(screen.queryByText('Saved: 8 reps · 60 kg')).toBeNull();
});

it('shows an unsent rest edit that the choice will replace', async () => {
  mockStatus.mockResolvedValue({ ownerId: 'A', pending: 0, rejected: 1 });
  mockConflicts.mockResolvedValue([blocked]);
  mockReview.mockResolvedValue({ ...review, workout: { sessionId: 'session-id', phase: 'resting', cursor: 0, units: 'kg',
    draft: { reps: 10, weight: 60, asBodyweight: false }, savedDraft: { reps: 8, weight: 60, asBodyweight: false },
    day: { blocks: [{ kind: 'straight', rounds: 1, items: [{ id: 'item', sets: 2 }] }] } } });
  const screen = render(<SyncRecovery userId="A" />);
  fireEvent.press(await screen.findByText('Review press set 1'));
  await screen.findByText('Unsent rest draft: 10 reps · 60 kg. Your choice will replace this draft; a recovery copy is kept.');
});
