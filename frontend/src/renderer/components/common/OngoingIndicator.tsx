
import { JSX } from 'react';
import { cn } from '@renderer/lib/utils';
import { Loader2 } from 'lucide-react';

interface OngoingIndicatorProps {
  size?: 'sm' | 'md';
  showLabel?: boolean;
  label?: string;
}

export const OngoingIndicator = ({
  size = 'sm',
  showLabel = false,
  label = 'Session in progress...',
}: Readonly<OngoingIndicatorProps>): JSX.Element => {
  const dotSize = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';

  return (
    <span className="inline-flex items-center gap-2" title="Session in progress">
      <span className={cn('relative flex shrink-0', dotSize)}>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span className={cn('relative inline-flex rounded-full bg-green-500', dotSize)} />
      </span>
      {showLabel && <span className="text-muted-foreground text-sm">{label}</span>}
    </span>
  );
};

export const OngoingBanner = (): JSX.Element => {
  return (
    <div className="border-border bg-card flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-3">
      <Loader2 className="text-muted-foreground size-4 shrink-0 animate-spin" />
      <span className="text-muted-foreground text-sm">Session is in progress...</span>
    </div>
  );
};
