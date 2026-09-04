import { JSX } from 'react';

import { Button } from '@renderer/components/ui/button';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { TriangleAlert } from 'lucide-react';

interface ErrorStateProps {
  message: string;
  detail?: string;
  retryLabel?: string;
  onRetry?: () => void;
}

export const ErrorState = ({
  message,
  detail,
  retryLabel = 'Retry',
  onRetry,
}: Readonly<ErrorStateProps>): JSX.Element => {
  const mode = useUIMode();

  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <TriangleAlert aria-hidden="true" className="text-destructive mb-3 size-8 opacity-80" />
      <p className="text-foreground text-sm font-medium">{message}</p>
      {mode === 'nerd' && detail ? (
        <p className="text-muted-foreground mt-1 max-w-md text-xs break-words">{detail}</p>
      ) : null}
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-3">
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
};
