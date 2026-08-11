import * as React from 'react';

import { Progress as ProgressPrimitive } from '@base-ui/react/progress';
import { cn } from '@renderer/lib/utils';

type ProgressProps = ProgressPrimitive.Root.Props & {
  indicatorClassName?: string;
  trackClassName?: string;
};

function Progress({ className, indicatorClassName, trackClassName, ...props }: ProgressProps) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <ProgressPrimitive.Track
        data-slot="progress-track"
        className={cn('size-full overflow-hidden rounded-full', trackClassName)}
      >
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className={cn('h-full w-full flex-1 bg-primary transition-all', indicatorClassName)}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
