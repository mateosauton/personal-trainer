import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import Overview from '@/app/session/[dayId]/index';
const mockRead = jest.fn(),
  mockStart = jest.fn(),
  mockReplace = jest.fn();
const mockRouter = { replace: mockReplace, back: jest.fn() };
let mockOwner = 'A';
const day = { id: 'day', name: 'Training', blocks: [] };
jest.mock('@/lib/auth', () => ({ useUserId: () => mockOwner }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ dayId: 'day' }),
  useRouter: () => mockRouter,
}));
jest.mock('@/lib/session/workout', () => ({
  workouts: { read: (...args: unknown[]) => mockRead(...args) },
}));
jest.mock('@/lib/db/queries', () => ({
  getActivePlan: async () => ({ days: [day] }),
  startSession: (...args: unknown[]) => mockStart(...args),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockOwner = 'A';
  mockRead.mockResolvedValue(null);
});
it.each(['read', 'start'])(
  'ignores a delayed %s result after switching accounts',
  async (step) => {
    let resolve!: (value: any) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    (step === 'read' ? mockRead : mockStart).mockReturnValue(pending);
    const screen = render(<Overview />);
    await waitFor(() => expect(screen.getByText('Begin')).toBeTruthy());
    fireEvent.press(screen.getByText('Begin'));
    await waitFor(() =>
      expect(step === 'read' ? mockRead : mockStart).toHaveBeenCalled(),
    );
    mockOwner = 'B';
    screen.rerender(<Overview />);
    await act(async () => {
      resolve(step === 'read' ? { day, sessionId: 'A-session' } : 'A-session');
    });
    expect(mockReplace).not.toHaveBeenCalled();
    if (step === 'read') expect(mockStart).not.toHaveBeenCalled();
  },
);
it('ignores a saved workout read after leaving the overview', async () => {
  let resolve!: (value: any) => void;
  mockRead.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const screen = render(<Overview />);
  await waitFor(() => expect(screen.getByText('Begin')).toBeTruthy());
  fireEvent.press(screen.getByText('Begin'));
  screen.unmount();
  await act(async () => {
    resolve({ day, sessionId: 'A-session' });
  });
  expect(mockReplace).not.toHaveBeenCalled();
});
