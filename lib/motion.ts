export type StepDirection = 'forward' | 'backward';

export const motion = {
  fast: 140,
  base: 240,
  settle: { damping: 16, stiffness: 260 },
  pop: { damping: 12, stiffness: 320 },
} as const;

export function getStepDirection(from: number, to: number): StepDirection {
  return to >= from ? 'forward' : 'backward';
}

export function getDoodleMotion(reducedMotion: boolean) {
  if (reducedMotion) return { distance: 0, rotate: 0, duration: 0 };
  return { distance: 14, rotate: 1.5, duration: motion.base };
}
