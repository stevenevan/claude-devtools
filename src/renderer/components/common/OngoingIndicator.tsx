/**
 * OngoingIndicator - Pulsing green dot for sessions/groups in progress.
 * Shared across SessionItem (sidebar) and LastOutputDisplay (chat).
 */

import React from 'react';

import { cn } from '@renderer/lib/utils';
import { Loader2 } from 'lucide-react';

interface OngoingIndicatorProps {
  /** Size variant */
  size?: 'sm' | 'md';
  /** Whether to show text label */
  showLabel?: boolean;
  /** Custom label text */
  label?: string;
}

/**
 * Pulsing green dot indicator for ongoing sessions.
 * Use size="sm" for compact displays (sidebar), size="md" for larger displays (chat).
 */
export const OngoingIndicator = ({
  size = 'sm',
  showLabel = false,
  label = 'Session in progress...',
}: Readonly<OngoingIndicatorProps>): React.JSX.Element => {
  const dotSize = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';

  return (
    <span className="inline-flex items-center gap-2" title="Session in progress">
      <span className={cn('relative flex shrink-0', dotSize)}>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span className={cn('relative inline-flex rounded-full bg-green-500', dotSize)} />
      </span>
      {showLabel && <span className="text-sm text-[var(--info-text)]">{label}</span>}
    </span>
  );
};

/**
 * OngoingBanner - Full-width banner variant for the LastOutputDisplay.
 * Shows animated spinner and text.
 */
export const OngoingBanner = (): React.JSX.Element => {
  return (
    <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--info-border)] bg-[var(--info-bg)] px-4 py-3">
      <Loader2 className="size-4 shrink-0 animate-spin text-[var(--info-text)]" />
      <span className="text-sm text-[var(--info-text)]">Session is in progress...</span>
    </div>
  );
};
