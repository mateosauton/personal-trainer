import { render } from '@testing-library/react-native';

import type { Plan, PlanDay } from '@/lib/types';

const mockState: { value: Record<string, unknown> } = { value: {} };

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    profile: {
      display_name: 'Mateo',
      avatar_url: null,
      units: 'kg',
      bodyweight_kg: 80,
    },
  }),
  useUserId: () => 'test-user',
}));

jest.mock('@/lib/useDashboard', () => ({
  useDashboard: () => mockState.value,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useFocusEffect: () => undefined,
}));

const day: PlanDay = {
  id: 'day-1',
  day_index: 0,
  name: 'Push A',
  focus: 'Chest and shoulders',
  blocks: [
    {
      id: 'b1',
      block_index: 0,
      kind: 'straight',
      title: 'Block 1 · Press',
      rounds: 1,
      rest_seconds: 90,
      items: [
        {
          id: 'i1', item_index: 0, exercise_id: 'Barbell_Bench_Press_-_Medium_Grip',
          sets: 4, reps_low: 6, reps_high: 8, seconds: null, tempo: null, notes: null,
        },
      ],
    },
  ],
};

const plan: Plan = { id: 'p1', name: 'Block 1', split: 'Upper/Lower', weeks: 4, days: [day] };

const baseState = {
  plan,
  nextDay: day,
  completedCount: 6,
  sessions: [],
  trainedDays: new Set<string>(),
  streak: 3,
  todaySessions: [],
  todayTotals: null,
  lastLoadKg: new Map([['Barbell_Bench_Press_-_Medium_Grip', 60]]),
  loading: false,
  error: null,
  reload: jest.fn(),
};

const Home = require('@/app/(tabs)/index').default;

describe('Home', () => {
  it('greets the user and offers the profile behind the avatar', () => {
    mockState.value = baseState;
    const { getByText, getByLabelText } = render(<Home />);

    expect(getByText('Welcome Mateo!')).toBeTruthy();
    expect(getByLabelText('Open your profile')).toBeTruthy();
  });

  it('shows the streak and the session count', () => {
    mockState.value = baseState;
    const { getByText } = render(<Home />);

    expect(getByText('3 days')).toBeTruthy();
    expect(getByText('6')).toBeTruthy();
  });

  it("estimates today's session before it is done", () => {
    mockState.value = baseState;
    const { getByText } = render(<Home />);

    expect(getByText('Start session')).toBeTruthy();
    expect(getByText('Est. reps')).toBeTruthy();
    // 4 sets x mid(6,8) = 28 planned reps.
    expect(getByText('28')).toBeTruthy();
  });

  it('switches to what actually happened once today is logged', () => {
    mockState.value = {
      ...baseState,
      todaySessions: [
        { id: 's1', started_at: new Date().toISOString(), duration_s: 2400, rpe: 8, plan_days: { name: 'Push A', focus: 'Chest' } },
      ],
      todayTotals: { sets: 12, reps: 96, volumeKg: 4820 },
    };
    const { getByText, queryByText } = render(<Home />);

    expect(getByText('Reps')).toBeTruthy();
    expect(getByText('96')).toBeTruthy();
    expect(getByText('40')).toBeTruthy(); // 2400s of session
    expect(queryByText('Est. reps')).toBeNull();
  });
});

describe('Home exercise strip', () => {
  it('shows a thumbnail per movement in the session', () => {
    mockState.value = baseState;
    const { getByTestId } = render(<Home />);

    expect(getByTestId('exercise-strip')).toBeTruthy();
    expect(getByTestId('exercise-thumb-Barbell_Bench_Press_-_Medium_Grip')).toBeTruthy();
  });

  it('shows each exercise once and counts the rest past six', () => {
    const ids = [
      'Barbell_Bench_Press_-_Medium_Grip', 'Barbell_Bench_Press_-_Medium_Grip',
      'Barbell_Shoulder_Press', 'Arnold_Dumbbell_Press', 'Alternating_Floor_Press',
      'Barbell_Guillotine_Bench_Press', 'Anti-Gravity_Press', 'Alternating_Kettlebell_Press',
    ];
    mockState.value = {
      ...baseState,
      nextDay: {
        ...day,
        blocks: [
          {
            ...day.blocks[0],
            items: ids.map((exercise_id, i) => ({
              id: `i${i}`, item_index: i, exercise_id,
              sets: 3, reps_low: 8, reps_high: 10, seconds: null, tempo: null, notes: null,
            })),
          },
        ],
      },
    };
    const { getByTestId, getByText, queryAllByTestId } = render(<Home />);

    // Seven distinct movements: six thumbnails and a "+1".
    expect(queryAllByTestId(/^exercise-thumb-/)).toHaveLength(6);
    expect(getByTestId('exercise-strip')).toBeTruthy();
    expect(getByText('+1')).toBeTruthy();
  });
});
