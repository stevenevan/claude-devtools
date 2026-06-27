import { FC } from 'react';

import { cn } from '@renderer/lib/utils';

import type { DiffLine } from './diffAlgorithm';

interface SplitDiffViewProps {
  diffLines: DiffLine[];
  maxHeight: string;
}

function buildSplitRows(
  diffLines: DiffLine[]
): { left: DiffLine | null; right: DiffLine | null }[] {
  const rows: { left: DiffLine | null; right: DiffLine | null }[] = [];
  let i = 0;
  while (i < diffLines.length) {
    const line = diffLines[i];
    if (line.type === 'context') {
      rows.push({ left: line, right: line });
      i++;
    } else if (line.type === 'removed') {
      // Check if next is added (paired change)
      const next = diffLines[i + 1];
      if (next?.type === 'added') {
        rows.push({ left: line, right: next });
        i += 2;
      } else {
        rows.push({ left: line, right: null });
        i++;
      }
    } else if (line.type === 'added') {
      rows.push({ left: null, right: line });
      i++;
    } else {
      i++;
    }
  }
  return rows;
}

const SplitDiffHalf: FC<{ line: DiffLine | null; side: 'left' | 'right' }> = ({ line }) => {
  if (!line) {
    return <div className="flex-1 bg-zinc-800/30 px-2 py-px" />;
  }
  const isRemoved = line.type === 'removed';
  const isAdded = line.type === 'added';
  return (
    <div
      className={cn(
        'flex flex-1 min-w-0 border-l-2 px-2 py-px',
        isRemoved && 'bg-red-500/10 border-red-500',
        isAdded && 'bg-green-500/10 border-green-500',
        !isRemoved && !isAdded && 'border-transparent'
      )}
    >
      <span
        className={cn(
          'flex-1 whitespace-pre',
          isRemoved && 'text-red-400',
          isAdded && 'text-green-400',
          !isRemoved && !isAdded && 'text-muted-foreground'
        )}
      >
        {line.content || ' '}
      </span>
    </div>
  );
};

export const SplitDiffView: FC<SplitDiffViewProps> = ({ diffLines, maxHeight }) => {
  const rows = buildSplitRows(diffLines);
  return (
    <div className={cn('overflow-auto font-mono text-xs', maxHeight)}>
      <div className="inline-block min-w-full">
        {rows.map((row, i) => (
          <div key={i} className="flex">
            <SplitDiffHalf line={row.left} side="left" />
            <div className="border-border w-px shrink-0 border-l" />
            <SplitDiffHalf line={row.right} side="right" />
          </div>
        ))}
        {rows.length === 0 && (
          <div className="text-muted-foreground px-3 py-2 italic">No changes detected</div>
        )}
      </div>
    </div>
  );
};
