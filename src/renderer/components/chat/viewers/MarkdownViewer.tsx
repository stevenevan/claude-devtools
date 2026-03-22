import React from 'react';

import { api } from '@renderer/api';
import { CopyButton } from '@renderer/components/common/CopyButton';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { FileText } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useShallow } from 'zustand/react/shallow';

import {
  createSearchContext,
  highlightSearchInChildren,
  type SearchContext,
} from '../searchHighlightUtils';
import { highlightLine } from '../viewers/syntaxHighlighter';

import type { SearchMatch } from '@renderer/store/types';

// =============================================================================
// Types
// =============================================================================

interface MarkdownViewerProps {
  content: string;
  maxHeight?: string; // e.g., "max-h-64" or "max-h-96"
  className?: string;
  label?: string; // Optional label like "Thinking", "Output", etc.
  /** When provided, enables search term highlighting within the markdown */
  itemId?: string;
  /** When true, shows a copy button (overlay when no label, inline in header when label exists) */
  copyable?: boolean;
}

// =============================================================================
// Component factories
// =============================================================================

function createViewerMarkdownComponents(searchCtx: SearchContext | null): Components {
  const hl = (children: React.ReactNode): React.ReactNode =>
    searchCtx ? highlightSearchInChildren(children, searchCtx) : children;

  return {
    // Headings
    h1: ({ children }) => (
      <h1 className="mt-4 mb-2 text-xl font-semibold text-foreground first:mt-0">
        {hl(children)}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-4 mb-2 text-lg font-semibold text-foreground first:mt-0">
        {hl(children)}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-3 mb-2 text-base font-semibold text-foreground first:mt-0">
        {hl(children)}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="mt-3 mb-1 text-sm font-semibold text-foreground first:mt-0">
        {hl(children)}
      </h4>
    ),
    h5: ({ children }) => (
      <h5 className="mt-2 mb-1 text-sm font-medium text-foreground first:mt-0">
        {hl(children)}
      </h5>
    ),
    h6: ({ children }) => (
      <h6 className="mt-2 mb-1 text-xs font-medium text-foreground first:mt-0">
        {hl(children)}
      </h6>
    ),

    // Paragraphs
    p: ({ children }) => (
      <p className="my-2 text-sm leading-relaxed text-foreground first:mt-0 last:mb-0">
        {hl(children)}
      </p>
    ),

    // Links — inline element, no hl(); parent block element's hl() descends here
    a: ({ href, children }) => (
      <a
        href={href}
        className="cursor-pointer text-blue-400 no-underline hover:underline"
        onClick={(e) => {
          e.preventDefault();
          if (href) {
            void api.openExternal(href);
          }
        }}
      >
        {children}
      </a>
    ),

    // Strong/Bold — inline element, no hl()
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),

    // Emphasis/Italic — inline element, no hl()
    em: ({ children }) => <em className="text-foreground italic">{children}</em>,

    // Strikethrough — inline element, no hl()
    del: ({ children }) => <del className="text-foreground line-through">{children}</del>,

    // Code: inline vs block detection
    code: (props) => {
      const {
        className: codeClassName,
        children,
        node,
      } = props as {
        className?: string;
        children?: React.ReactNode;
        node?: {
          position?: { start: { line: number }; end: { line: number } };
        };
      };
      const hasLanguage = codeClassName?.includes('language-');
      const isMultiLine =
        (node?.position && node.position.end.line > node.position.start.line) ?? false;
      const isBlock = (hasLanguage ?? false) || isMultiLine;

      if (isBlock) {
        const lang = codeClassName?.replace('language-', '') ?? '';
        const raw = typeof children === 'string' ? children : '';
        const text = raw.replace(/\n$/, '');
        const lines = text.split('\n');
        return (
          <code className="text-foreground font-mono text-xs">
            {lines.map((line, i) => (
              <React.Fragment key={i}>
                {hl(highlightLine(line, lang))}
                {i < lines.length - 1 ? '\n' : null}
              </React.Fragment>
            ))}
          </code>
        );
      }
      // Inline code — no hl(); parent block element's hl() descends here
      return (
        <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
          {children}
        </code>
      );
    },

    // Code blocks
    pre: ({ children }) => (
      <pre className="my-3 overflow-x-auto rounded-lg border border-border bg-muted p-3 text-xs leading-relaxed">
        {children}
      </pre>
    ),

    // Blockquotes
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-4 border-border pl-4 text-muted-foreground italic">
        {hl(children)}
      </blockquote>
    ),

    // Lists
    ul: ({ children }) => (
      <ul className="my-2 list-disc space-y-1 pl-5 text-foreground">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 list-decimal space-y-1 pl-5 text-foreground">{children}</ol>
    ),
    li: ({ children }) => <li className="text-sm text-foreground">{hl(children)}</li>,

    // Tables
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table className="min-w-full border-collapse border-border/50 text-sm">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-card">{children}</thead>
    ),
    th: ({ children }) => (
      <th className="border border-border/50 px-3 py-2 text-left font-semibold text-foreground">
        {hl(children)}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-border/50 px-3 py-2 text-foreground">
        {hl(children)}
      </td>
    ),

    // Horizontal rule
    hr: () => <hr className="my-4 border-border/50" />,
  };
}

/** Default components without search highlighting */
const defaultComponents = createViewerMarkdownComponents(null);

/** Stable default to avoid infinite re-renders when itemId is falsy */
const EMPTY_SEARCH_STATE = {
  searchQuery: '',
  searchMatches: [] as SearchMatch[],
  currentSearchIndex: -1,
};

// =============================================================================
// Component
// =============================================================================

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({
  content,
  maxHeight = 'max-h-96',
  className = '',
  label,
  itemId,
  copyable = false,
}) => {
  // Only re-render if THIS item has search matches
  const { searchQuery, searchMatches, currentSearchIndex } = useStore(
    useShallow((s) =>
      itemId
        ? {
            searchQuery: s.searchQuery,
            searchMatches: s.searchMatches,
            currentSearchIndex: s.currentSearchIndex,
          }
        : EMPTY_SEARCH_STATE
    )
  );

  // Create search context (fresh each render so counter starts at 0)
  const searchCtx =
    searchQuery && itemId
      ? createSearchContext(searchQuery, itemId, searchMatches, currentSearchIndex)
      : null;

  // Create markdown components with optional search highlighting
  // When search is active, create fresh each render (match counter is stateful and must start at 0)
  // useMemo would cache stale closures when parent re-renders without search deps changing
  const components = searchCtx ? createViewerMarkdownComponents(searchCtx) : defaultComponents;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg shadow-xs bg-muted border border-border',
        copyable && !label && 'group relative',
        className
      )}
    >
      {/* Copy button overlay (when no label header) */}
      {copyable && !label && <CopyButton text={content} />}

      {/* Optional header - matches CodeBlockViewer style */}
      {label && (
        <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2">
          <FileText className="text-muted-foreground size-4 shrink-0" />
          <span className="text-muted-foreground text-sm font-medium">{label}</span>
          {copyable && (
            <>
              <span className="flex-1" />
              <CopyButton text={content} inline />
            </>
          )}
        </div>
      )}

      {/* Markdown content with scroll */}
      <div className={cn('overflow-auto', maxHeight)}>
        <div className="p-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
};
