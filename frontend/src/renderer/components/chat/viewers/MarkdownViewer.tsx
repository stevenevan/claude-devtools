import { ReactNode, Fragment, FC } from 'react';

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

interface MarkdownViewerProps {
  content: string;
  maxHeight?: string;
  className?: string;
  label?: string;
  itemId?: string;
  copyable?: boolean;
}

function createViewerMarkdownComponents(searchCtx: SearchContext | null): Components {
  const hl = (children: ReactNode): ReactNode =>
    searchCtx ? highlightSearchInChildren(children, searchCtx) : children;

  return {
    h1: ({ children }) => (
      <h1 className="text-foreground mt-4 mb-2 text-xl font-semibold first:mt-0">{hl(children)}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-foreground mt-4 mb-2 text-lg font-semibold first:mt-0">{hl(children)}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-foreground mt-3 mb-2 text-base font-semibold first:mt-0">
        {hl(children)}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-foreground mt-3 mb-1 text-sm font-semibold first:mt-0">{hl(children)}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="text-foreground mt-2 mb-1 text-sm font-medium first:mt-0">{hl(children)}</h5>
    ),
    h6: ({ children }) => (
      <h6 className="text-foreground mt-2 mb-1 text-xs font-medium first:mt-0">{hl(children)}</h6>
    ),

    p: ({ children }) => (
      <p className="text-foreground my-2 text-sm leading-relaxed first:mt-0 last:mb-0">
        {hl(children)}
      </p>
    ),

    // Links — inline element, no hl(); parent block element's hl() descends here
    a: ({ href, children }) => {
      const isExternal = /^https?:\/\//i.test(href ?? '');
      return (
        <a
          href={isExternal ? href : undefined}
          className="cursor-pointer text-blue-400 no-underline hover:underline"
          onClick={(e) => {
            e.preventDefault();
            if (isExternal && href) void api.openExternal(href);
          }}
        >
          {children}
        </a>
      );
    },

    strong: ({ children }) => <strong className="text-foreground font-semibold">{children}</strong>,
    em: ({ children }) => <em className="text-foreground italic">{children}</em>,
    del: ({ children }) => <del className="text-foreground line-through">{children}</del>,

    // Code: inline vs block detection
    code: (props) => {
      const {
        className: codeClassName,
        children,
        node,
      } = props as {
        className?: string;
        children?: ReactNode;
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
              <Fragment key={i}>
                {hl(highlightLine(line, lang))}
                {i < lines.length - 1 ? '\n' : null}
              </Fragment>
            ))}
          </code>
        );
      }
      // Inline code — no hl(); parent block element's hl() descends here
      return (
        <code className="bg-muted text-foreground rounded-sm px-1.5 py-0.5 font-mono text-xs">
          {children}
        </code>
      );
    },

    pre: ({ children }) => (
      <pre className="border-border bg-muted my-3 overflow-x-auto rounded-lg border p-3 text-xs leading-relaxed">
        {children}
      </pre>
    ),

    blockquote: ({ children }) => (
      <blockquote className="border-border text-muted-foreground my-3 border-l-4 pl-4 italic">
        {hl(children)}
      </blockquote>
    ),

    ul: ({ children }) => (
      <ul className="text-foreground my-2 list-disc space-y-1 pl-5">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="text-foreground my-2 list-decimal space-y-1 pl-5">{children}</ol>
    ),
    li: ({ children }) => <li className="text-foreground text-sm">{hl(children)}</li>,

    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table className="border-border/50 min-w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-card">{children}</thead>,
    th: ({ children }) => (
      <th className="border-border/50 text-foreground border px-3 py-2 text-left font-semibold">
        {hl(children)}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-border/50 text-foreground border px-3 py-2">{hl(children)}</td>
    ),

    hr: () => <hr className="border-border/50 my-4" />,
  };
}

const defaultComponents = createViewerMarkdownComponents(null);

// Stable default to avoid re-renders when itemId is falsy (empty itemId → no store subscription)
const EMPTY_SEARCH_STATE = {
  searchQuery: '',
  searchMatches: [] as SearchMatch[],
  currentSearchIndex: -1,
};

export const MarkdownViewer: FC<MarkdownViewerProps> = ({
  content,
  maxHeight = 'max-h-96',
  className = '',
  label,
  itemId,
  copyable = false,
}) => {
  'use no memo'; // counter in createSearchContext must reset each render; compiler memoization would stale it
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

  const searchCtx =
    searchQuery && itemId
      ? createSearchContext(searchQuery, itemId, searchMatches, currentSearchIndex)
      : null;

  // Create fresh each render when search active — match counter is stateful and must start at 0
  const components = searchCtx ? createViewerMarkdownComponents(searchCtx) : defaultComponents;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg shadow-xs bg-muted border border-border',
        copyable && !label && 'group relative',
        className
      )}
    >
      {copyable && !label && <CopyButton text={content} />}

      {label && (
        <div className="border-border bg-muted flex items-center gap-2 border-b px-3 py-2">
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
