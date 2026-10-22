import { fireEvent, render } from '@testing-library/react-native';

import { ExerciseWeightProgressCard, WeightSuggestionCard } from '@/components/ExerciseWeight';
import type { WeightSuggestion } from '@/lib/weights';

const suggestion: WeightSuggestion = {
  weightKg: 50,
  source: 'progress',
  sourceExerciseId: 'bench',
  previousWeightKg: 47.5,
};

describe('WeightSuggestionCard', () => {
  it('offers an editable saved target in kilograms', () => {
    const onChangeText = jest.fn();
    const { getByLabelText, getByText } = render(
      <WeightSuggestionCard suggestion={suggestion} units="kg" value="50" onChangeText={onChangeText} isBodyweight={false} />,
    );

    expect(getByText('Suggested weight')).toBeTruthy();
    expect(getByText('Saved target')).toBeTruthy();
    expect(getByText('50 kg')).toBeTruthy();
    const input = getByLabelText('Weight to use (kg)');
    expect(input.props.keyboardType).toBe('decimal-pad');
    fireEvent.changeText(input, '52.5');
    expect(onChangeText).toHaveBeenCalledWith('52.5');
  });

  it('converts a previous workout and names the equivalent exercise', () => {
    const { getByLabelText, getByText } = render(
      <WeightSuggestionCard suggestion={{ ...suggestion, source: 'history' }} units="lb" value="110.2" onChangeText={() => {}} isBodyweight={false} sourceName="Barbell bench press" />,
    );

    expect(getByText('110.2 lb')).toBeTruthy();
    expect(getByText('Previous workout · Barbell bench press')).toBeTruthy();
    expect(getByLabelText('Weight to use (lb)').props.value).toBe('110.2');
  });

  it('identifies a load already used earlier in the current session', () => {
    const { getByText, queryByText } = render(
      <WeightSuggestionCard suggestion={{ ...suggestion, source: 'session' }} units="kg" value="50" onChangeText={() => {}} isBodyweight={false} />,
    );

    expect(getByText('Earlier set today')).toBeTruthy();
    expect(queryByText('Previous workout')).toBeNull();
  });

  it('asks for a starting weight without inventing a recommendation', () => {
    const { getByText, getByLabelText, queryByText } = render(
      <WeightSuggestionCard suggestion={{ weightKg: null, source: 'new', sourceExerciseId: null, previousWeightKg: null }} units="kg" value="" onChangeText={() => {}} isBodyweight={false} />,
    );

    expect(getByText('Record your starting weight')).toBeTruthy();
    expect(getByLabelText('Weight to use (kg)').props.value).toBe('');
    expect(queryByText('0 kg')).toBeNull();
  });

  it('clearly treats zero as bodyweight with no added load', () => {
    const { getByText, getByLabelText } = render(
      <WeightSuggestionCard suggestion={{ weightKg: 0, source: 'bodyweight', sourceExerciseId: null, previousWeightKg: null }} units="kg" value="0" onChangeText={() => {}} isBodyweight disabled />,
    );

    expect(getByText('Suggested added load')).toBeTruthy();
    expect(getByText('Bodyweight · No added load')).toBeTruthy();
    expect(getByLabelText('Added load to use (kg)').props.editable).toBe(false);
  });
});

describe('ExerciseWeightProgressCard', () => {
  it('compares top weight with the previous actual workout', () => {
    const { getByText } = render(
      <ExerciseWeightProgressCard progress={{ topWeightKg: 55, previousWeightKg: 50, deltaKg: 5 }} units="kg" isBodyweight={false} setsCompleted={3} />,
    );

    expect(getByText('Exercise complete')).toBeTruthy();
    expect(getByText('3 sets completed')).toBeTruthy();
    expect(getByText('55 kg')).toBeTruthy();
    expect(getByText('Previous workout: 50 kg')).toBeTruthy();
    expect(getByText('+5 kg vs previous workout')).toBeTruthy();
  });

  it('shows a signed decrease in pounds without calling it a strength loss', () => {
    const { getByText, queryByText } = render(
      <ExerciseWeightProgressCard progress={{ topWeightKg: 45, previousWeightKg: 50, deltaKg: -5 }} units="lb" isBodyweight={false} setsCompleted={1} />,
    );

    expect(getByText('1 set completed')).toBeTruthy();
    expect(getByText('99.2 lb')).toBeTruthy();
    expect(getByText('Previous workout: 110.2 lb')).toBeTruthy();
    expect(getByText('-11 lb vs previous workout')).toBeTruthy();
    expect(queryByText(/strength loss/i)).toBeNull();
  });

  it('labels bodyweight comparisons as added load', () => {
    const { getByText } = render(
      <ExerciseWeightProgressCard progress={{ topWeightKg: 5, previousWeightKg: 0, deltaKg: 5 }} units="kg" isBodyweight setsCompleted={2} />,
    );

    expect(getByText('Top added load today')).toBeTruthy();
    expect(getByText('Previous added load: Bodyweight · No added load')).toBeTruthy();
    expect(getByText('+5 kg added load vs previous workout')).toBeTruthy();
  });

  it('marks the first recorded workout without a made-up delta', () => {
    const { getByText, queryByText } = render(
      <ExerciseWeightProgressCard progress={{ topWeightKg: 20, previousWeightKg: null, deltaKg: null }} units="kg" isBodyweight={false} setsCompleted={2} />,
    );

    expect(getByText('First recorded workout')).toBeTruthy();
    expect(queryByText(/vs previous workout/)).toBeNull();
  });

  it('distinguishes unavailable history from a first workout', () => {
    const { getByText, queryByText } = render(
      <ExerciseWeightProgressCard progress={{ topWeightKg: 20, previousWeightKg: null, deltaKg: null }} units="kg" isBodyweight={false} setsCompleted={2} historyAvailable={false} />,
    );

    expect(getByText('Previous workout unavailable')).toBeTruthy();
    expect(queryByText('First recorded workout')).toBeNull();
  });

  it('avoids negative zero when the difference is below display precision', () => {
    const { getByText, queryByText } = render(
      <ExerciseWeightProgressCard progress={{ topWeightKg: 50, previousWeightKg: 50, deltaKg: -0.0000001 }} units="kg" isBodyweight={false} setsCompleted={2} />,
    );

    expect(getByText('No change from previous workout')).toBeTruthy();
    expect(queryByText(/-0/)).toBeNull();
  });

  it('never renders non-finite weights as numbers', () => {
    const { getByText, queryByText } = render(
      <ExerciseWeightProgressCard progress={{ topWeightKg: Number.NaN, previousWeightKg: Number.POSITIVE_INFINITY, deltaKg: Number.NaN }} units="kg" isBodyweight={false} setsCompleted={2} />,
    );

    expect(getByText('No weight recorded')).toBeTruthy();
    expect(queryByText(/NaN|Infinity/)).toBeNull();
  });
});
