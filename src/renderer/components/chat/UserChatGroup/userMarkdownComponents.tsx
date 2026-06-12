import React from 'react';

import { type Components } from 'react-markdown';

import { highlightSearchInChildren, type SearchContext } from '../searchHighlightUtils';

import { highlightPaths } from './pathHighlighting';

/**
 * Creates markdown components for user bubble rendering.
 * Uses chat-user CSS variables for consistent styling and wraps
 * text-bearing elements through highlightPaths for @path tag injection
 * and optional search term highlighting.
 */
export function createUserMarkdownComponents(
  validatedPaths: Record<string, boolean>,
  searchCtx: SearchContext | null
): Components {
  // Compose path highlighting with optional search highlighting
  // eslint-disable-next-line sonarjs/function-return-type -- React child manipulation inherently returns mixed node types
  const hl = (children: React.ReactNode): React.ReactNode => {
    const withPaths = highlightPaths(children, validatedPaths);
    return searchCtx ? highlightSearchInChildren(withPaths, searchCtx) : withPaths;
  };

  return {
    h1: ({ children }) => (
      <h1 className="text-muted-foreground mt-6 mb-3 text-lg font-semibold first:mt-0">
        {hl(children)}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-muted-foreground mt-5 mb-2 text-base font-semibold first:mt-0">
        {hl(children)}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-muted-foreground mt-4 mb-2 text-sm font-semibold first:mt-0">
        {hl(children)}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-muted-foreground mt-3 mb-1.5 text-sm font-semibold first:mt-0">
        {hl(children)}
      </h4>
    ),
    h5: ({ children }) => (
      <h5 className="text-muted-foreground mt-2 mb-1 text-sm font-medium first:mt-0">
        {hl(children)}
      </h5>
    ),
    h6: ({ children }) => (
      <h6 className="text-muted-foreground mt-2 mb-1 text-xs font-medium first:mt-0">
        {hl(children)}
      </h6>
    ),

    p: ({ children }) => (
      <p className="text-muted-foreground my-2 text-sm leading-relaxed first:mt-0 last:mb-0">
        {hl(children)}
      </p>
    ),

    // Inline elements — no hl(); parent block element's hl() descends here
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-foreground no-underline hover:underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),

    strong: ({ children }) => (
      <strong className="text-muted-foreground font-semibold">{children}</strong>
    ),

    em: ({ children }) => <em className="text-muted-foreground italic">{children}</em>,

    del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,

    code: ({ className, children }) => {
      const hasLanguageClass = className?.includes('language-');
      const content = typeof children === 'string' ? children : '';
      const isMultiLine = content.includes('\n');
      const isBlock = (hasLanguageClass ?? false) || isMultiLine;

      if (isBlock) {
        return (
          <code className="text-muted-foreground block font-mono text-xs">{hl(children)}</code>
        );
      }
      // Inline code — no hl()
      return (
        <code className="border-border bg-muted text-foreground rounded-sm border px-1.5 py-0.5 font-mono text-xs">
          {children}
        </code>
      );
    },

    pre: ({ children }) => (
      <pre className="border-border text-muted-foreground my-3 overflow-x-auto rounded-lg border bg-[rgba(0,0,0,0.15)] p-3 font-mono text-xs leading-relaxed">
        {children}
      </pre>
    ),

    blockquote: ({ children }) => (
      <blockquote className="border-border text-muted-foreground my-3 border-l-4 pl-4 italic">
        {hl(children)}
      </blockquote>
    ),

    ul: ({ children }) => (
      <ul className="text-muted-foreground my-2 list-disc space-y-1 pl-5">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="text-muted-foreground my-2 list-decimal space-y-1 pl-5">{children}</ol>
    ),
    li: ({ children }) => <li className="text-muted-foreground text-sm">{hl(children)}</li>,

    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table className="border-border min-w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-[rgba(0,0,0,0.1)]">{children}</thead>,
    th: ({ children }) => (
      <th className="border-border text-muted-foreground border px-3 py-2 text-left font-semibold">
        {hl(children)}
      </th>
    ),
    td: ({ children }) => (
      <td className="border-border text-muted-foreground border px-3 py-2">{hl(children)}</td>
    ),

    hr: () => <hr className="border-border my-4" />,
  };
}
