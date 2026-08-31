import { fireEvent, render } from '@testing-library/react-native';

import Onboarding from '@/app/onboarding';

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ refreshProfile: jest.fn() }),
  useUserId: () => 'test-user',
}));

jest.mock('@/lib/db/queries', () => ({
  savePlan: jest.fn(),
  updateProfile: jest.fn(),
  uploadAvatar: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

describe('Onboarding', () => {
  it('advances and keeps the selected answer exposed as a radio state', () => {
    const { getByRole, getByText, getByTestId } = render(<Onboarding />);

    fireEvent.press(getByText('Continue'));
    const strength = getByRole('radio', { name: /Get stronger/ });
    fireEvent.press(strength);

    expect(strength.props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId('selected-marker')).toBeTruthy();
  });
});
