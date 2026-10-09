import { render } from '@testing-library/react-native';
import Index from '@/app/index';

let mockAuth: Record<string, unknown>;
const mockRedirect = jest.fn();
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('expo-router', () => ({ Redirect: (props: unknown) => { mockRedirect(props); return null; } }));

beforeEach(() => {
  mockRedirect.mockClear();
  mockAuth = { session: { user: { id: 'A' } }, loading: false, processingAuthLink: false,
    recoveringPassword: false, profileState: { status: 'ready', profile: null } };
});

it('routes a newly confirmed account to onboarding', () => {
  render(<Index />);
  expect(mockRedirect).toHaveBeenCalledWith({ href: '/onboarding' });
});
it('keeps a recovery callback on the password reset route', () => {
  mockAuth.recoveringPassword = true;
  render(<Index />);
  expect(mockRedirect).toHaveBeenCalledWith({ href: '/reset-password' });
});
it.each(['loading', 'error'])('waits for a usable profile while its state is %s', (status) => {
  mockAuth.profileState = { status };
  render(<Index />);
  expect(mockRedirect).not.toHaveBeenCalled();
});
it('waits for a callback exchange before choosing a route', () => {
  mockAuth.processingAuthLink = true;
  render(<Index />);
  expect(mockRedirect).not.toHaveBeenCalled();
});
it('routes an onboarded account to its tabs', () => {
  mockAuth.profileState = { status: 'ready', profile: { onboarded_at: 'now' } };
  render(<Index />);
  expect(mockRedirect).toHaveBeenCalledWith({ href: '/(tabs)' });
});
it('routes a signed-out visitor to sign-in', () => {
  mockAuth.session = null;
  render(<Index />);
  expect(mockRedirect).toHaveBeenCalledWith({ href: '/sign-in' });
});
