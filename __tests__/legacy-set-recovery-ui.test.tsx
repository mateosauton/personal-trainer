import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { LegacySetRecovery } from '@/components/LegacySetRecovery';
const mockReview = jest.fn(), mockResolve = jest.fn();
jest.mock('@/lib/session/sync', () => ({
  reviewLegacySetConflict: (...args: unknown[]) => mockReview(...args),
  resolveLegacySetConflict: (...args: unknown[]) => mockResolve(...args),
}));
const set = { plan_item_id: 'item', exercise_id: 'press', set_index: 1, reps: 8, weight_kg: 60,
  is_bodyweight: false, added_load_kg: 0, rpe: null };
const captured = { operation: { id: 'id', kind: 'set' as const, payload: { sessionId: 'session', set } }, code: 'PT409', resolved: false };
const review = { ownerId: 'A', captured, saved: { id: 'id', sessionId: 'session', set },
  server: { serverVersion: 4, set: { ...set, reps: 12 }, eventAt: '2026-10-06T11:00:00Z' }, workout: null, accountGeneration: 1 };
beforeEach(() => { mockReview.mockReset().mockResolvedValue(review); mockResolve.mockReset().mockResolvedValue(undefined); });
async function open() {
  const screen = render(<LegacySetRecovery userId="A" captured={captured} onResolved={async () => {}} />);
  fireEvent.press(screen.getByText('Review older press set 1'));
  await screen.findByText('Older saved set: 8 reps · 60 kg');
  return screen;
}
it('allows the server choice without guessing the missing legacy time', async () => {
  const screen = await open();
  expect(screen.getByText('Server: 12 reps · 60 kg')).toBeTruthy();
  fireEvent.press(screen.getByText('Use server set'));
  await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('A', review, 'server', undefined));
});
it('requires an explicitly entered original time for the older saved choice', async () => {
  const screen = await open();
  fireEvent.press(screen.getByText('Keep older set at this time'));
  expect(mockResolve).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('Completion date in UTC'), '2026-09-01');
  fireEvent.changeText(screen.getByLabelText('Completion time in UTC'), '10:30');
  fireEvent.press(screen.getByText('Keep older set at this time'));
  await waitFor(() => expect(mockResolve).toHaveBeenCalledWith('A', review, 'saved', '2026-09-01T10:30:00.000Z'));
});
it('preserves the older edit when the user closes the comparison', async () => {
  const screen = await open(); fireEvent.press(screen.getByText('Close older set review'));
  expect(mockResolve).not.toHaveBeenCalled();
  expect(screen.queryByText('Older saved set: 8 reps · 60 kg')).toBeNull();
});
it('does not display a late review after its component unmounts', async () => {
  let release!: (value: unknown) => void;
  mockReview.mockImplementation(() => new Promise(done => { release = done; }));
  const screen = render(<LegacySetRecovery userId="A" captured={captured} onResolved={async () => {}} />);
  fireEvent.press(screen.getByText('Review older press set 1')); screen.unmount();
  await act(async () => { release(review); });
  expect(mockResolve).not.toHaveBeenCalled();
});
it('does not offer replacement controls for finalized workouts', async () => {
  mockReview.mockResolvedValue({ ...review, captured: { ...captured, code: 'PT410' } });
  const screen = await open();
  expect(screen.queryByText('Use server set')).toBeNull();
  expect(screen.queryByText('Keep older set at this time')).toBeNull();
});
