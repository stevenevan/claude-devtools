import React from 'react';

import { cn } from '@renderer/lib/utils';
import { getBaseName } from '@renderer/utils/pathUtils';
import { formatTokens } from '@shared/utils/tokenFormatting';
import { Pencil } from 'lucide-react';

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
        isRemoved && 'bg-[var(--diff-removed-bg)] border-[var(--diff-removed-border)]',
        isAdded && 'bg-[var(--diff-added-bg)] border-[var(--diff-added-border)]',
        isContext && 'bg-transparent border-transparent'
      )}
    >
      {/* Line number */}
      <span className="w-10 shrink-0 px-2 text-right text-[var(--code-line-number)] select-none">
        {line.lineNumber}
      </span>
      {/* Prefix */}
      <span
        className={cn(
          'w-6 shrink-0 select-none',
          isRemoved && 'text-[var(--diff-removed-text)]',
          isAdded && 'text-[var(--diff-added-text)]',
          isContext && 'text-text-secondary'
        )}
      >
        {prefix}
      </span>
      {/* Content */}
      <span
        className={cn(
          'flex-1 whitespace-pre',
          isRemoved && 'text-[var(--diff-removed-text)]',
          isAdded && 'text-[var(--diff-added-text)]',
          isContext && 'text-text-secondary'
        )}
      >
        {line.content || ' '}
      </span>
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
    <div className="overflow-hidden rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] shadow-xs">
      {/* Header - matches CodeBlockViewer style */}
      <div className="flex items-center gap-2 border-b border-[var(--code-border)] bg-[var(--code-header-bg)] px-3 py-2">
        <Pencil className="text-text-muted size-4 shrink-0" />
        <span className="truncate font-mono text-sm text-[var(--code-filename)]">
          {displayName}
        </span>
        <span className="shrink-0 rounded-sm border border-[var(--tag-border)] bg-[var(--tag-bg)] px-1.5 py-0.5 text-xs text-[var(--tag-text)]">
          {detectedLanguage}
        </span>
        <span className="text-text-muted">-</span>
        <span className="shrink-0 text-sm">
          {stats.added > 0 && (
            <span className="mr-1 text-[var(--diff-added-text)]">+{stats.added}</span>
          )}
          {stats.removed > 0 && (
            <span className="text-[var(--diff-removed-text)]">-{stats.removed}</span>
          )}
          {stats.added === 0 && stats.removed === 0 && (
            <span className="text-text-muted">Changed</span>
          )}
        </span>
        {tokenCount !== undefined && tokenCount > 0 && (
          <span className="text-text-muted ml-auto text-xs">
            ~{formatTokens(tokenCount)} tokens
          </span>
        )}
      </div>

      {/* Diff content */}
      <div className={cn('overflow-auto font-mono text-xs', maxHeight)}>
        <div className="inline-block min-w-full">
          {diffLines.map((line, index) => (
            <DiffLineRow key={index} line={line} />
          ))}
          {diffLines.length === 0 && (
            <div className="text-text-muted px-3 py-2 italic">No changes detected</div>
          )}
        </div>
      </div>
    </div>
  );
};
