import { JSX } from 'react';

import { Skeleton } from '../ui/skeleton';

export const SkeletonShell = (): JSX.Element => {
  return (
    <div className="flex h-screen w-screen overflow-hidden" role="status" aria-label="Loading workspace">
      <span className="sr-only">Loading workspace…</span>
      <div className="flex w-12 flex-col items-center gap-2 border-r border-border py-2" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-8 rounded-md" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2" aria-hidden="true">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-6 w-24" />
          <div className="flex-1" />
          <Skeleton className="h-6 w-6 rounded-full" />
        </div>
        <div className="flex flex-col gap-2 p-4" aria-hidden="true">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
};
