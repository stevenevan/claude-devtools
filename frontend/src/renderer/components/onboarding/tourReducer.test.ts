import { describe, expect, test } from 'bun:test';

import { initialTourState, TOUR_STEPS, tourReducer } from './tourReducer';

describe('tourReducer mode selection', () => {
  test('requires an explicit mode before finishing', () => {
    const running = {
      ...initialTourState,
      phase: 'running' as const,
      index: TOUR_STEPS.length - 1,
    };

    expect(tourReducer(running, { type: 'finish' })).toEqual(running);
    const selected = tourReducer(running, { type: 'selectMode', mode: 'simple' });
    expect(tourReducer(selected, { type: 'finish' })).toEqual({
      ...selected,
      phase: 'done',
    });
  });

  test('skip selects Nerd mode and completes tour', () => {
    const running = tourReducer(initialTourState, { type: 'start' });

    expect(tourReducer(running, { type: 'skip' })).toEqual({
      phase: 'done',
      index: 0,
      selectedMode: 'nerd',
    });
  });

  test('restart clears previous selection', () => {
    const selected = tourReducer(tourReducer(initialTourState, { type: 'start' }), {
      type: 'selectMode',
      mode: 'simple',
    });

    expect(tourReducer(selected, { type: 'restart' })).toEqual({
      phase: 'running',
      index: 0,
      selectedMode: null,
    });
  });
});
