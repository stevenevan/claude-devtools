import React, { useMemo } from 'react';

import { useClipboard } from '@renderer/hooks/mantine';
import { cn } from '@renderer/lib/utils';
import { getBaseName } from '@renderer/utils/pathUtils';
import { createLogger } from '@shared/utils/logger';
import { Check, Copy, FileCode } from 'lucide-react';

const logger = createLogger('Component:CodeBlockViewer');

import { highlightLine } from './syntaxHighlighter';

// =============================================================================
// Types
// =============================================================================

interface CodeBlockViewerProps {
  fileName: string; // e.g., "src/components/Header.tsx"
  content: string; // The actual file content
  language?: string; // Inferred from file extension if not provided
  startLine?: number; // If partial read, starting line
  endLine?: number; // If partial read, ending line
  maxHeight?: string; // CSS max-height class (default: "max-h-96")
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
// Component
// =============================================================================

export const CodeBlockViewer: React.FC<CodeBlockViewerProps> = ({
  fileName,
  content,
  language,
  startLine = 1,
  endLine,
  maxHeight = 'max-h-96',
}): React.JSX.Element => {
  const { copy, copied } = useClipboard({ timeout: 2000 });

  // Infer language from file extension if not provided
  const detectedLanguage = language ?? inferLanguage(fileName);

  // Split content into lines
  const lines = useMemo(() => content.split('\n'), [content]);
  const totalLines = lines.length;

  // Calculate the actual line range for display
  const actualEndLine = endLine ?? startLine + totalLines - 1;

  // Extract just the filename for display
  const displayFileName = getBaseName(fileName) || fileName;

  return (
    <div className="border-border bg-muted overflow-hidden rounded-lg border shadow-xs">
      {/* Header */}
      <div className="border-border bg-muted flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode className="text-muted-foreground size-4 shrink-0" />
          <span className="truncate font-mono text-sm text-blue-400" title={fileName}>
            {displayFileName}
          </span>
          {(startLine > 1 || endLine) && (
            <span className="text-muted-foreground shrink-0 text-xs">
              (lines {startLine}-{actualEndLine})
            </span>
          )}
          <span className="border-border bg-card text-muted-foreground shrink-0 rounded-sm border px-1.5 py-0.5 text-xs">
            {detectedLanguage}
          </span>
        </div>

        {/* Copy button */}
        <button
          onClick={() => copy(content)}
          className="rounded-sm bg-transparent p-1 transition-colors hover:opacity-80"
          title="Copy to clipboard"
        >
          {copied ? (
            <Check className="size-4 text-green-600" />
          ) : (
            <Copy className="text-muted-foreground size-4" />
          )}
        </button>
      </div>

      {/* Code content */}
      <div className={cn('overflow-auto', maxHeight)}>
        <pre className="m-0 bg-transparent p-0">
          <code className="block font-mono text-xs leading-relaxed">
            {lines.map((line, index) => {
              const lineNumber = startLine + index;
              return (
                <div key={index} className="hover:bg-popover flex">
                  {/* Line number */}
                  <span className="border-border w-12 shrink-0 border-r px-3 py-0.5 text-right text-zinc-600 select-none">
                    {lineNumber}
                  </span>
                  {/* Code line */}
                  <span className="text-foreground flex-1 px-4 py-0.5 whitespace-pre">
                    {highlightLine(line, detectedLanguage)}
                  </span>
                </div>
              );
            })}
          </code>
        </pre>
      </div>
    </div>
  );
};
