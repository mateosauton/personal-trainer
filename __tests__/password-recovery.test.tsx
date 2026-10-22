import { act, fireEvent, render } from '@testing-library/react-native';
import SignIn from '@/app/(auth)/sign-in';
import ResetPassword from '@/app/reset-password';

const mockResetEmail = jest.fn();
const mockUpdate = jest.fn();
const mockSignOut = jest.fn();
jest.mock('@/lib/db/supabase', () => ({ supabase: { auth: {
  resetPasswordForEmail: (...args: unknown[]) => mockResetEmail(...args),
  updateUser: (...args: unknown[]) => mockUpdate(...args),
} } }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ signOut: mockSignOut }) }));
jest.mock('@/lib/deep-link', () => ({ authRedirectTo: () => 'officegym://', authRecoveryRedirectTo: () => 'officegym://reset-password' }));
jest.mock('@/lib/dev-auth', () => ({ devLoginEnabled: false }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
beforeEach(() => {
  jest.clearAllMocks(); mockResetEmail.mockResolvedValue({ error: null }); mockUpdate.mockResolvedValue({ error: null }); mockSignOut.mockResolvedValue(undefined);
});
it('requests recovery without requiring the old password', async () => {
  const screen = render(<SignIn />);
  fireEvent.press(screen.getByText('Forgot password?'));
  fireEvent.changeText(screen.getByPlaceholderText('Email'), ' person@example.com ');
  await act(async () => { fireEvent.press(screen.getByText('Send reset link')); });
  expect(mockResetEmail).toHaveBeenCalledWith('person@example.com', { redirectTo: 'officegym://reset-password' });
  expect(screen.getByText(/If an account exists/)).toBeTruthy();
});
it('shows reset email failures and allows retry', async () => {
  mockResetEmail.mockResolvedValueOnce({ error: new Error('Email unavailable') });
  const screen = render(<SignIn />);
  fireEvent.press(screen.getByText('Forgot password?'));
  fireEvent.changeText(screen.getByPlaceholderText('Email'), 'person@example.com');
  await act(async () => { fireEvent.press(screen.getByText('Send reset link')); });
  expect(screen.getByText('Email unavailable')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText('Send reset link')); });
  expect(mockResetEmail).toHaveBeenCalledTimes(2);
});
it('rejects mismatching new passwords without updating the account', async () => {
  const screen = render(<ResetPassword />);
  fireEvent.changeText(screen.getByPlaceholderText('New password'), 'new-password');
  fireEvent.changeText(screen.getByPlaceholderText('Confirm password'), 'different-password');
  await act(async () => { fireEvent.press(screen.getByText('Save password')); });
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(screen.getByText('Passwords do not match.')).toBeTruthy();
});
it('updates the password and ends the recovery session for a fresh sign-in', async () => {
  const screen = render(<ResetPassword />);
  fireEvent.changeText(screen.getByPlaceholderText('New password'), 'new-password');
  fireEvent.changeText(screen.getByPlaceholderText('Confirm password'), 'new-password');
  await act(async () => { fireEvent.press(screen.getByText('Save password')); });
  expect(mockUpdate).toHaveBeenCalledWith({ password: 'new-password' });
  expect(mockSignOut).toHaveBeenCalledTimes(1);
});
it('keeps the recovery form available when the backend rejects an update', async () => {
  mockUpdate.mockResolvedValue({ error: new Error('Password rejected') });
  const screen = render(<ResetPassword />);
  fireEvent.changeText(screen.getByPlaceholderText('New password'), 'new-password');
  fireEvent.changeText(screen.getByPlaceholderText('Confirm password'), 'new-password');
  await act(async () => { fireEvent.press(screen.getByText('Save password')); });
  expect(screen.getByText('Password rejected')).toBeTruthy();
  expect(mockSignOut).not.toHaveBeenCalled();
});
