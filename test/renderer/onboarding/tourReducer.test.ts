import { describe, expect, it } from 'vitest';

import {
  initialTourState,
  TOUR_STEPS,
  tourReducer,
} from '@renderer/components/onboarding/tourReducer';

describe('tourReducer', () => {
  it('start moves to running at index 0', () => {
    const next = tourReducer(initialTourState, { type: 'start' });
    expect(next).toEqual({ phase: 'running', index: 0 });
  });

  it('next advances within the step list', () => {
    let s = tourReducer(initialTourState, { type: 'start' });
    s = tourReducer(s, { type: 'next' });
    expect(s).toEqual({ phase: 'running', index: 1 });
  });

  it('next on the final step transitions to done', () => {
    const last = TOUR_STEPS.length - 1;
    let s: ReturnType<typeof tourReducer> = { phase: 'running', index: last };
    s = tourReducer(s, { type: 'next' });
    expect(s.phase).toBe('done');
  });

  it('prev clamps at 0', () => {
    let s = tourReducer(initialTourState, { type: 'start' });
    s = tourReducer(s, { type: 'prev' });
    expect(s.index).toBe(0);
  });

  it('skip transitions to done from any running step', () => {
    let s = tourReducer(initialTourState, { type: 'start' });
    s = tourReducer(s, { type: 'next' });
    s = tourReducer(s, { type: 'skip' });
    expect(s.phase).toBe('done');
  });

  it('restart resets to running step 0 even from done', () => {
    const done = { phase: 'done' as const, index: 3 };
    const restarted = tourReducer(done, { type: 'restart' });
    expect(restarted).toEqual({ phase: 'running', index: 0 });
  });

  it('next is a no-op when phase is inactive or done', () => {
    const inactive = tourReducer(initialTourState, { type: 'next' });
    expect(inactive).toEqual(initialTourState);
    const done = tourReducer({ phase: 'done', index: 2 }, { type: 'next' });
    expect(done).toEqual({ phase: 'done', index: 2 });
  });
});
