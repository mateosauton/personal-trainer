import { act, fireEvent, render } from '@testing-library/react-native';

import { RestPage } from '@/components/RestPage';

jest.mock('@/components/ExerciseMedia', () => ({ ExerciseMedia: () => null }));

const baseProps = {
  exercise: null, setLabel: 'Set 1 of 2', targetReps: '6–8 reps',
  units: 'kg' as const, bodyweightKg: 80, restSeconds: 120,
  draft: { reps: 8, weight: 20, asBodyweight: false },
  onChange: jest.fn(), next: { exercise: null, name: 'Row', set: 2, setsTotal: 2 },
  onAdvance: jest.fn(),
};

describe('rest countdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-21T12:00:00Z'));
    jest.clearAllMocks();
  });
  afterEach(() => jest.useRealTimers());

  it('catches up to elapsed wall time after the app was suspended', () => {
    const screen = render(<RestPage {...baseProps} />);
    act(() => {
      jest.setSystemTime(new Date('2026-10-21T12:01:10Z'));
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByText('0:49')).toBeTruthy();
    expect(baseProps.onAdvance).not.toHaveBeenCalled();
  });

  it('freezes rest while the workout is paused and resumes without losing time', () => {
    const screen = render(<RestPage {...baseProps} paused={false} />);
    act(() => jest.advanceTimersByTime(10_000));
    screen.rerender(<RestPage {...baseProps} paused />);
    act(() => jest.advanceTimersByTime(30_000));
    expect(screen.getByText('1:50')).toBeTruthy();
    screen.rerender(<RestPage {...baseProps} paused={false} />);
    act(() => jest.advanceTimersByTime(10_000));
    expect(screen.getByText('1:40')).toBeTruthy();
  });

  it('allows manual corrections without automatically advancing at zero', () => {
    const screen = render(<RestPage {...baseProps} restSeconds={1} />);
    fireEvent.press(screen.getAllByLabelText('Increase')[0]);
    expect(baseProps.onChange).toHaveBeenCalledWith(expect.objectContaining({ reps: 9 }));
    act(() => jest.advanceTimersByTime(2000));
    expect(screen.getByText('Next set')).toBeTruthy();
    expect(baseProps.onAdvance).not.toHaveBeenCalled();
  });
});
