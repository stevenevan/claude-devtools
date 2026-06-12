import React from 'react';

import { cn } from '@renderer/lib/utils';

import type { DiffLine } from './diffAlgorithm';

interface DiffLineRowProps {
  line: DiffLine;
}

export const DiffLineRow: React.FC<DiffLineRowProps> = ({ line }): React.JSX.Element => {
  const isRemoved = line.type === 'removed';
  const isAdded = line.type === 'added';
  const isContext = line.type === 'context';

  const prefix = isRemoved ? '-' : isAdded ? '+' : ' ';

  return (
    <div
      className={cn(
        'flex min-w-full border-l-[3px]',
        isRemoved && 'bg-red-500/15 border-red-500',
        isAdded && 'bg-green-500/15 border-green-500',
        isContext && 'bg-transparent border-transparent'
      )}
    >
      {/* Line number */}
      <span className="w-10 shrink-0 px-2 text-right text-zinc-600 select-none">
        {line.lineNumber}
      </span>
      {/* Prefix */}
      <span
        className={cn(
          'w-6 shrink-0 select-none',
          isRemoved && 'text-red-400',
          isAdded && 'text-green-400',
          isContext && 'text-muted-foreground'
        )}
      >
        {prefix}
      </span>
      {/* Content */}
      <span
        className={cn(
          'flex-1 whitespace-pre',
          isRemoved && 'text-red-400',
          isAdded && 'text-green-400',
          isContext && 'text-muted-foreground'
        )}
      >
        {line.content || ' '}
      </span>
    </div>
  );
};
