import React from 'react';

import { highlightSearchInChildren, type SearchContext } from './searchHighlightUtils';

import type { Components } from 'react-markdown';

/**
 * Create inline markdown components for rendering prose content.
 * When searchCtx is provided, search term highlighting is applied
 * to text nodes while preserving full markdown rendering.
 */
export function createMarkdownComponents(searchCtx: SearchContext | null): Components {
  const hl = (children: React.ReactNode): React.ReactNode =>
    searchCtx ? highlightSearchInChildren(children, searchCtx) : children;

  return {
    // Headings - Bold text with generous spacing to break up content
    h1: ({ children }) => (
      <h1 className="mt-6 mb-3 text-lg font-semibold text-[var(--prose-heading)] first:mt-0">
        {hl(children)}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-5 mb-2 text-base font-semibold text-[var(--prose-heading)] first:mt-0">
        {hl(children)}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-4 mb-2 text-sm font-semibold text-[var(--prose-heading)] first:mt-0">
        {hl(children)}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="mt-3 mb-1.5 text-sm font-semibold text-[var(--prose-heading)] first:mt-0">
        {hl(children)}
      </h4>
    ),
    h5: ({ children }) => (
      <h5 className="mt-2 mb-1 text-sm font-medium text-[var(--prose-heading)] first:mt-0">
        {hl(children)}
      </h5>
    ),
    h6: ({ children }) => (
      <h6 className="mt-2 mb-1 text-xs font-medium text-[var(--prose-heading)] first:mt-0">
        {hl(children)}
      </h6>
    ),

    // Paragraphs
    p: ({ children }) => (
      <p className="my-2 text-sm leading-relaxed text-[var(--prose-body)] first:mt-0 last:mb-0">
        {hl(children)}
      </p>
    ),

    // Links — inline element, no hl(); parent block element's hl() descends here
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-[var(--prose-link)] no-underline hover:underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),

    // Strong/Bold — inline element, no hl()
    strong: ({ children }) => (
      <strong className="font-semibold text-[var(--prose-heading)]">{children}</strong>
    ),

    // Emphasis/Italic — inline element, no hl()
    em: ({ children }) => <em className="text-[var(--prose-body)] italic">{children}</em>,

    // Strikethrough — inline element, no hl()
    del: ({ children }) => <del className="text-[var(--prose-body)] line-through">{children}</del>,

    // Inline code vs block code
    code: ({ className, children }) => {
      const hasLanguageClass = className?.includes('language-');
      const content = typeof children === 'string' ? children : '';
      const isMultiLine = content.includes('\n');
      const isBlock = (hasLanguageClass ?? false) || isMultiLine;

      if (isBlock) {
        return <code className="text-text block font-mono text-xs">{hl(children)}</code>;
      }
      // Inline code — no hl(); parent block element's hl() descends here
      return (
        <code className="rounded-sm bg-[var(--prose-code-bg)] px-1.5 py-0.5 font-mono text-xs text-[var(--prose-code-text)]">
          {children}
        </code>
      );
    },

    // Code blocks
    pre: ({ children }) => (
      <pre className="text-text my-3 overflow-x-auto rounded-lg border border-[var(--prose-pre-border)] bg-[var(--prose-pre-bg)] p-3 font-mono text-xs leading-relaxed">
        {children}
      </pre>
    ),

    // Blockquotes
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-4 border-[var(--prose-blockquote-border)] pl-4 text-[var(--prose-muted)] italic">
        {hl(children)}
      </blockquote>
    ),

    // Lists
    ul: ({ children }) => (
      <ul className="my-2 list-disc space-y-1 pl-5 text-[var(--prose-body)]">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 list-decimal space-y-1 pl-5 text-[var(--prose-body)]">{children}</ol>
    ),
    li: ({ children }) => <li className="text-sm text-[var(--prose-body)]">{hl(children)}</li>,

    // Tables
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table className="min-w-full border-collapse border-[var(--prose-table-border)] text-sm">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-[var(--prose-table-header-bg)]">{children}</thead>
    ),
    th: ({ children }) => (
      <th className="border border-[var(--prose-table-border)] px-3 py-2 text-left font-semibold text-[var(--prose-heading)]">
        {hl(children)}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-[var(--prose-table-border)] px-3 py-2 text-[var(--prose-body)]">
        {hl(children)}
      </td>
    ),

    // Horizontal rule
    hr: () => <hr className="my-4 border-[var(--prose-table-border)]" />,
  };
}

/** Default markdown components without search highlighting (used by CompactBoundary) */
export const markdownComponents: Components = createMarkdownComponents(null);
