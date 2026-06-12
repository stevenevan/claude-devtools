import React from 'react';

import { cn } from '@renderer/lib/utils';
import { getBaseName } from '@renderer/utils/pathUtils';
import { formatTokens } from '@shared/utils/tokenFormatting';
import { Columns2, Pencil, Rows3 } from 'lucide-react';

import { computeStats, generateDiff } from './diffAlgorithm';
import { DiffLineRow } from './DiffLineRow';
import { inferLanguage } from './languageDetection';
import { SplitDiffView } from './SplitDiffView';

interface DiffViewerProps {
  fileName: string;
  oldString: string;
  newString: string;
  maxHeight?: string;
  tokenCount?: number;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  fileName,
  oldString,
  newString,
  maxHeight = 'max-h-96',
  tokenCount,
}): React.JSX.Element => {
  const [mode, setMode] = React.useState<'unified' | 'split'>('unified');

  const oldLines = oldString.split('\n');
  const newLines = newString.split('\n');
  const diffLines = generateDiff(oldLines, newLines);
  const stats = computeStats(diffLines);
  const detectedLanguage = inferLanguage(fileName);
  const displayName = getBaseName(fileName);

  return (
    <div className="border-border bg-muted overflow-hidden rounded-lg border shadow-xs">
      <div className="border-border bg-muted flex items-center gap-2 border-b px-3 py-2">
        <Pencil className="text-muted-foreground size-4 shrink-0" />
        <span className="truncate font-mono text-sm text-blue-400">{displayName}</span>
        <span className="border-border bg-card text-muted-foreground shrink-0 rounded-sm border px-1.5 py-0.5 text-xs">
          {detectedLanguage}
        </span>
        <span className="text-muted-foreground">-</span>
        <span className="shrink-0 text-sm">
          {stats.added > 0 && <span className="mr-1 text-green-400">+{stats.added}</span>}
          {stats.removed > 0 && <span className="text-red-400">-{stats.removed}</span>}
          {stats.added === 0 && stats.removed === 0 && (
            <span className="text-muted-foreground">Changed</span>
          )}
        </span>
        {tokenCount !== undefined && tokenCount > 0 && (
          <span className="text-muted-foreground ml-auto text-xs">
            ~{formatTokens(tokenCount)} tokens
          </span>
        )}
        <button
          onClick={() => setMode(mode === 'unified' ? 'split' : 'unified')}
          className="text-muted-foreground hover:text-foreground ml-auto shrink-0 transition-colors"
          title={mode === 'unified' ? 'Switch to side-by-side' : 'Switch to unified'}
        >
          {mode === 'unified' ? <Columns2 className="size-3.5" /> : <Rows3 className="size-3.5" />}
        </button>
      </div>

      {mode === 'unified' ? (
        <div className={cn('overflow-auto font-mono text-xs', maxHeight)}>
          <div className="inline-block min-w-full">
            {diffLines.map((line, index) => (
              <DiffLineRow key={index} line={line} />
            ))}
            {diffLines.length === 0 && (
              <div className="text-muted-foreground px-3 py-2 italic">No changes detected</div>
            )}
          </div>
        </div>
      ) : (
        <SplitDiffView diffLines={diffLines} maxHeight={maxHeight} />
      )}
    </div>
  );
};
