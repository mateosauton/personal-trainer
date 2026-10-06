import { fireEvent, render, waitFor } from '@testing-library/react-native';
import Home from '@/app/(tabs)/index';
const mockRead = jest.fn(),
  mockPush = jest.fn();
const mockRouter = { push: mockPush, back: jest.fn() };
let mockOwner = 'A';
const saved = {
  ownerId: 'A',
  sessionId: 'saved-session',
  day: { id: 'original-day', name: 'Saved training' },
  endedAtMs: null,
};
jest.mock('@/lib/session/workout', () => ({
  workouts: { read: (...args: unknown[]) => mockRead(...args) },
}));
jest.mock('@/lib/auth', () => ({
  useUserId: () => mockOwner,
  useAuth: () => ({ profile: null }),
}));
jest.mock('@/lib/useDashboard', () => ({
  useDashboard: () => ({ loading: true, error: null, reload: () => undefined }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: () => undefined,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockOwner = 'A';
  mockRead.mockResolvedValue(saved);
});
it('offers offline resume even while the dashboard is still loading', async () => {
  const screen = render(<Home />);
  await waitFor(() => expect(screen.getByText('Resume workout')).toBeTruthy());
  fireEvent.press(screen.getByText('Resume workout'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/session/[dayId]/run',
    params: { dayId: 'original-day', sessionId: 'saved-session' },
  });
});
it('hides the prior account workout immediately during account switching', async () => {
  const screen = render(<Home />);
  await waitFor(() => expect(screen.getByText('Saved training')).toBeTruthy());
  mockOwner = 'B';
  mockRead.mockResolvedValue(null);
  screen.rerender(<Home />);
  expect(screen.queryByText('Saved training')).toBeNull();
  expect(screen.queryByText('Resume workout')).toBeNull();
  await waitFor(() => expect(mockRead).toHaveBeenCalledWith('B'));
});
