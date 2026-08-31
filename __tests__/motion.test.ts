import { getDoodleMotion, getStepDirection } from '@/lib/motion';

describe('onboarding motion', () => {
  it('derives travel direction from the step index', () => {
    expect(getStepDirection(1, 2)).toBe('forward');
    expect(getStepDirection(4, 3)).toBe('backward');
  });

  it('removes movement when reduced motion is requested', () => {
    expect(getDoodleMotion(true)).toEqual({ distance: 0, rotate: 0, duration: 0 });
  });

  it('keeps the doodle settle subtle at normal motion', () => {
    expect(getDoodleMotion(false)).toEqual({ distance: 14, rotate: 1.5, duration: 240 });
  });
});
