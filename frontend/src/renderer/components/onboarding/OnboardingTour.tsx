import { JSX, useEffect, useReducer, useState } from 'react';
import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { Compass, LayoutPanelTop, PanelsTopLeft, X } from 'lucide-react';

import { initialTourState, TOUR_STEPS, tourReducer } from './tourReducer';

import type { UIMode } from '@shared/types';

const MODE_OPTIONS: readonly {
  mode: UIMode;
  label: string;
  description: string;
  icon: typeof LayoutPanelTop;
}[] = [
  {
    mode: 'simple',
    label: 'Simple',
    description: 'Focused navigation for everyday session review.',
    icon: LayoutPanelTop,
  },
  {
    mode: 'nerd',
    label: 'Nerd',
    description: 'All tools, tabs, and workspace controls stay visible.',
    icon: PanelsTopLeft,
  },
];

export const OnboardingTour = (): JSX.Element | null => {
  const onboardingCompleted = useStore((s) => s.appConfig?.onboardingCompleted ?? false);
  const [state, dispatch] = useReducer(tourReducer, initialTourState);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (state.phase === 'inactive' && !onboardingCompleted) {
      dispatch({ type: 'start' });
    }
  }, [onboardingCompleted, state.phase]);

  const persistDone = async (mode: UIMode): Promise<boolean> => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await api.config.update('general', { uiMode: mode });
      const config = await api.config.update('onboarding', { completed: true });
      useStore.setState({ appConfig: config });
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save interface mode');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const skipTour = async (): Promise<void> => {
    if (await persistDone('nerd')) dispatch({ type: 'skip' });
  };

  const finishTour = async (): Promise<void> => {
    if (!state.selectedMode) return;
    if (await persistDone(state.selectedMode)) dispatch({ type: 'finish' });
  };

  if (state.phase !== 'running') return null;
  const step = TOUR_STEPS[state.index];
  const total = TOUR_STEPS.length;
  const isModeStep = step.id === 'mode';

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
            onClick={() => void skipTour()}
            aria-label="Skip tour and use Nerd mode"
            className="text-text-muted ml-auto"
            disabled={isSaving}
          >
            <X className="size-3" />
          </Button>
        </div>
        <h2 id="onboarding-title" className="text-text text-base font-semibold">
          {step.title}
        </h2>
        <p className="text-text-secondary text-sm leading-relaxed">{step.body}</p>
        {saveError && (
          <p role="alert" className="text-destructive text-sm">
            {saveError}. Try again.
          </p>
        )}
        {isModeStep && (
          <div role="radiogroup" aria-label="Interface mode" className="grid gap-2 py-1">
            {MODE_OPTIONS.map(({ mode, label, description, icon: Icon }) => {
              const isSelected = state.selectedMode === mode;
              return (
                <Button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  variant={isSelected ? 'secondary' : 'outline'}
                  className="h-auto justify-start gap-3 px-3 py-3 text-left whitespace-normal"
                  onClick={() => dispatch({ type: 'selectMode', mode })}
                  disabled={isSaving}
                >
                  <Icon className="text-primary size-4" aria-hidden="true" />
                  <span className="flex flex-col items-start gap-0.5">
                    <span className="text-text text-sm font-medium">{label}</span>
                    <span className="text-text-secondary text-xs font-normal">{description}</span>
                  </span>
                </Button>
              );
            })}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: 'prev' })}
            disabled={state.index === 0 || isSaving}
          >
            Back
          </Button>
          {state.index + 1 < total ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => dispatch({ type: 'next' })}
              disabled={isSaving}
            >
              Continue
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => void finishTour()}
              disabled={!state.selectedMode || isSaving}
            >
              Get started
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
