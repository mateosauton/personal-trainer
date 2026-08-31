import { render } from '@testing-library/react-native';

import { ProgressBar } from '@/components/ui';

describe('ProgressBar', () => {
  it('exposes its current value to assistive technology', () => {
    const { getByTestId } = render(<ProgressBar value={0.45} />);

    expect(getByTestId('progress-bar')).toHaveAccessibilityValue({ now: 45, min: 0, max: 100 });
  });
});
