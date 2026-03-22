/**
 * ModeSelector - Segmented control for selecting trigger mode - Linear style.
 */

import { cn } from '@renderer/lib/utils';

import { MODE_OPTIONS } from '../utils/constants';

import type { TriggerMode } from '@renderer/types/data';

interface ModeSelectorProps {
  value: TriggerMode;
  onChange: (mode: TriggerMode) => void;
  disabled?: boolean;
}

export const ModeSelector = ({
  value,
  onChange,
  disabled = false,
}: Readonly<ModeSelectorProps>): React.JSX.Element => {
  return (
    <div className="bg-card inline-flex gap-0.5 rounded-md p-0.5">
      {MODE_OPTIONS.map((mode) => {
        const Icon = mode.icon;
        const isActive = value === mode.value;

        return (
          <button
            key={mode.value}
            type="button"
            onClick={() => onChange(mode.value)}
            disabled={disabled}
            className={cn(
              'flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-xs font-medium transition-colors',
              isActive
                ? 'bg-indigo-500/20 text-indigo-400'
                : 'text-muted-foreground hover:bg-card hover:text-muted-foreground',
              disabled && 'cursor-not-allowed opacity-50'
            )}
          >
            <Icon className="size-3.5" />
            {mode.label}
          </button>
        );
      })}
    </div>
  );
};
