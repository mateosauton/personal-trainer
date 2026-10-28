import {
  planScreenSummary,
  planScreenTitle,
  sessionCardMeta,
  sessionCardTitle,
} from '@/lib/plan/estimate';

describe('plan screen copy', () => {
  it('names a personalized plan the way PL03 does', () => {
    expect(planScreenTitle(false)).toBe('Your plan');
    expect(planScreenSummary(3, 4, 2, false)).toBe('3 days a week · 4 week block · 2 logged');
    expect(planScreenSummary(1, 4, 0, false)).toBe('1 day a week · 4 week block · 0 logged');
    expect(planScreenSummary(3, 4, null, false)).toBe('3 days a week · 4 week block');
  });

  it('names the authored rotation the way PL04 does', () => {
    expect(planScreenTitle(true)).toBe('Push · Pull · Legs');
    expect(planScreenSummary(6, 6, 2, true)).toBe('6-session rotation · 6 week block · 2 logged');
  });

  it('marks only the next session and counts the collapsed card', () => {
    expect(sessionCardTitle('Full body A', 0, true)).toBe('Up next · Full body A');
    expect(sessionCardTitle('Full body B', 1, false)).toBe('Day 2 · Full body B');
    expect(sessionCardMeta(48, 3, 15)).toBe('48 min · 3 blocks · 15 sets');
    expect(sessionCardMeta(47, 1, 1)).toBe('47 min · 1 block · 1 set');
  });
});
