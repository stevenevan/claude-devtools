import React from 'react';

import { cn } from '@renderer/lib/utils';
import { getBaseName } from '@renderer/utils/pathUtils';
import { formatTokens } from '@shared/utils/tokenFormatting';
import { Columns2, Pencil, Rows3 } from 'lucide-react';

// =============================================================================
// Types
// =============================================================================

interface DiffViewerProps {
  fileName: string; // The file being edited
  oldString: string; // The original text being replaced
  newString: string; // The new text
  maxHeight?: string; // CSS max-height class (default: "max-h-96")
  tokenCount?: number; // Optional token count to display in header
}

interface DiffLine {
  type: 'removed' | 'added' | 'context';
  content: string;
  lineNumber: number;
}

// =============================================================================
// Diff Algorithm (LCS-based)
// =============================================================================

/**
 * Computes the Longest Common Subsequence matrix for two arrays of strings.
 */
function computeLCSMatrix(oldLines: string[], newLines: string[]): number[][] {
  const m = oldLines.length;
  const n = newLines.length;
  const matrix: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1] + 1;
      } else {
        matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
      }
    }
  }

  return matrix;
}

/**
 * Backtrack through LCS matrix to generate diff lines.
 */
function generateDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const matrix = computeLCSMatrix(oldLines, newLines);
  const result: DiffLine[] = [];

  let i = oldLines.length;
  let j = newLines.length;
  let lineNumber = 1;

  // Temporary storage for backtracking
  const temp: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      // Lines are the same - context
      temp.push({ type: 'context', content: oldLines[i - 1], lineNumber: 0 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
      // Line was added
      temp.push({ type: 'added', content: newLines[j - 1], lineNumber: 0 });
      j--;
    } else if (i > 0) {
      // Line was removed
      temp.push({ type: 'removed', content: oldLines[i - 1], lineNumber: 0 });
      i--;
    }
  }

  // Reverse and assign line numbers
  temp.reverse();
  for (const line of temp) {
    line.lineNumber = lineNumber++;
    result.push(line);
  }

  return result;
}

/**
 * Computes diff statistics.
 */
function computeStats(diffLines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;

  for (const line of diffLines) {
    if (line.type === 'added') added++;
    if (line.type === 'removed') removed++;
  }

  return { added, removed };
}

// =============================================================================
// Language Detection
// =============================================================================

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  // JavaScript/TypeScript
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',

  // Python
  '.py': 'python',
  '.pyw': 'python',
  '.pyx': 'python',

  // Web
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',

  // Data formats
  '.json': 'json',
  '.jsonl': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',

  // Shell
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'zsh',
  '.fish': 'fish',

  // Systems
  '.rs': 'rust',
  '.go': 'go',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'hpp',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',

  // Config
  '.env': 'env',
  '.gitignore': 'gitignore',
  '.dockerignore': 'dockerignore',
  '.md': 'markdown',
  '.mdx': 'mdx',

  // Other
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.rb': 'ruby',
  '.php': 'php',
  '.lua': 'lua',
  '.r': 'r',
  '.R': 'r',
};

/**
 * Infer language from file name/extension.
 */
function inferLanguage(fileName: string): string {
  // Check for dotfiles with specific names
  const baseName = getBaseName(fileName);
  if (baseName === 'Dockerfile') return 'dockerfile';
  if (baseName === 'Makefile') return 'makefile';
  if (baseName.startsWith('.env')) return 'env';

  // Extract extension
  const extMatch = /(\.[^./]+)$/.exec(fileName);
  if (extMatch) {
    const ext = extMatch[1].toLowerCase();
    return EXTENSION_LANGUAGE_MAP[ext] ?? 'text';
  }

  return 'text';
}

// =============================================================================
// Diff Line Component
// =============================================================================

interface DiffLineRowProps {
  line: DiffLine;
}

const DiffLineRow: React.FC<DiffLineRowProps> = ({ line }): React.JSX.Element => {
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

// =============================================================================
// Split (Side-by-Side) Diff View
// =============================================================================

interface SplitDiffViewProps {
  diffLines: DiffLine[];
  maxHeight: string;
}

/** Build paired rows for side-by-side display. */
function buildSplitRows(diffLines: DiffLine[]): Array<{ left: DiffLine | null; right: DiffLine | null }> {
  const rows: Array<{ left: DiffLine | null; right: DiffLine | null }> = [];
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

const SplitDiffHalf: React.FC<{ line: DiffLine | null; side: 'left' | 'right' }> = ({ line }) => {
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

const SplitDiffView: React.FC<SplitDiffViewProps> = ({ diffLines, maxHeight }) => {
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

// =============================================================================
// Main Component
// =============================================================================

export const DiffViewer: React.FC<DiffViewerProps> = ({
  fileName,
  oldString,
  newString,
  maxHeight = 'max-h-96',
  tokenCount,
}): React.JSX.Element => {
  const [mode, setMode] = React.useState<'unified' | 'split'>('unified');

  // Compute diff
  const oldLines = oldString.split('\n');
  const newLines = newString.split('\n');
  const diffLines = generateDiff(oldLines, newLines);
  const stats = computeStats(diffLines);

  // Infer language from file extension
  const detectedLanguage = inferLanguage(fileName);

  // Format summary
  const displayName = getBaseName(fileName);

  return (
    <div className="border-border bg-muted overflow-hidden rounded-lg border shadow-xs">
      {/* Header - matches CodeBlockViewer style */}
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
        {/* Unified / Split toggle */}
        <button
          onClick={() => setMode(mode === 'unified' ? 'split' : 'unified')}
          className="text-muted-foreground hover:text-foreground ml-auto shrink-0 transition-colors"
          title={mode === 'unified' ? 'Switch to side-by-side' : 'Switch to unified'}
        >
          {mode === 'unified' ? <Columns2 className="size-3.5" /> : <Rows3 className="size-3.5" />}
        </button>
      </div>

      {/* Diff content */}
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
