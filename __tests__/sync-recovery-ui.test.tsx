import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SyncRecovery } from '@/components/SyncRecovery';
const mockStatus = jest.fn(),
  mockRetry = jest.fn();
jest.mock('@/lib/session/sync', () => ({
  getSyncStatus: (...args: unknown[]) => mockStatus(...args),
  retrySync: (...args: unknown[]) => mockRetry(...args),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockRetry.mockResolvedValue(undefined);
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
