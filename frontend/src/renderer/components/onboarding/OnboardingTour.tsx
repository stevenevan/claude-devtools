import { JSX, useEffect, useReducer } from 'react';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { Compass, X } from 'lucide-react';

import { initialTourState, TOUR_STEPS, tourReducer } from './tourReducer';

export const OnboardingTour = (): JSX.Element | null => {
  const onboardingCompleted = useStore((s) => s.appConfig?.onboardingCompleted ?? false);
  const updateConfig = useStore((s) => s.updateConfig);
  const [state, dispatch] = useReducer(tourReducer, initialTourState);

  useEffect(() => {
    if (state.phase === 'inactive' && !onboardingCompleted) {
      dispatch({ type: 'start' });
    }
  }, [onboardingCompleted, state.phase]);

  const persistDone = (): void => {
    void updateConfig('onboarding', { completed: true });
  };

  if (state.phase !== 'running') return null;
  const step = TOUR_STEPS[state.index];
  const total = TOUR_STEPS.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="border-border bg-surface-overlay flex w-full max-w-md flex-col gap-3 rounded-lg border p-5 shadow-xl">
        <div className="flex items-center gap-2">
          <Compass className="text-primary size-4" aria-hidden="true" />
          <span className="text-text-muted text-[10px] tracking-wider uppercase">
            Step {state.index + 1} of {total}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => {
              dispatch({ type: 'skip' });
              persistDone();
            }}
            aria-label="Skip tour"
            className="text-text-muted ml-auto"
          >
            <X className="size-3" />
          </Button>
        </div>
        <h2 id="onboarding-title" className="text-text text-base font-semibold">
          {step.title}
        </h2>
        <p className="text-text-secondary text-sm leading-relaxed">{step.body}</p>
        <div className="mt-2 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: 'prev' })}
            disabled={state.index === 0}
          >
            Back
          </Button>
          <div className="flex gap-2">
            {state.index + 1 < total ? (
              <Button variant="secondary" size="sm" onClick={() => dispatch({ type: 'next' })}>
                Next
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  dispatch({ type: 'finish' });
                  persistDone();
                }}
              >
                Get started
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
