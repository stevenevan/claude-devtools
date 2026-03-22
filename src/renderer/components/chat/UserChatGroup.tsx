import React, { useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { useTabUI } from '@renderer/hooks/useTabUI';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { createLogger } from '@shared/utils/logger';
import { format } from 'date-fns';
import { User } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useShallow } from 'zustand/react/shallow';

import { CopyButton } from '../common/CopyButton';

import {
  createSearchContext,
  EMPTY_SEARCH_MATCHES,
  highlightSearchInChildren,
  type SearchContext,
} from './searchHighlightUtils';

import type { UserGroup } from '@renderer/types/groups';

const logger = createLogger('Component:UserChatGroup');

// Pattern for @paths only (file references)
const PATH_PATTERN = /@([^\s,)}\]]+)/g;

interface UserChatGroupProps {
  userGroup: UserGroup;
}

/**
 * Recursively walks React children and replaces text nodes containing @path
 * references with styled spans using validated path state.
 */
// eslint-disable-next-line sonarjs/function-return-type -- React child manipulation inherently returns mixed node types
function highlightTextNode(text: string, validatedPaths: Record<string, boolean>): React.ReactNode {
  const pathPattern = /@[^\s,)}\]]+/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  pathPattern.lastIndex = 0;
  while ((match = pathPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const fullMatch = match[0];
    const isValid = validatedPaths[fullMatch] === true;

    if (isValid) {
      parts.push(
        <span
          key={match.index}
          className="rounded border border-[var(--chat-user-tag-border)] bg-[var(--chat-user-tag-bg)] px-1.5 py-0.5 font-mono text-[0.8125em] text-[var(--chat-user-tag-text)]"
        >
          {fullMatch}
        </span>
      );
    } else {
      parts.push(fullMatch);
    }

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  if (parts.length === 0) return text;
  if (parts.length === 1) return parts[0];
  return parts;
}

// eslint-disable-next-line sonarjs/function-return-type -- React child manipulation inherently returns mixed node types
function highlightPaths(
  children: React.ReactNode,
  validatedPaths: Record<string, boolean>
): React.ReactNode {
  // eslint-disable-next-line sonarjs/function-return-type -- React child manipulation inherently returns mixed node types
  return React.Children.map(children, (child): React.ReactNode => {
    if (typeof child === 'string') {
      return highlightTextNode(child, validatedPaths);
    }

    if (React.isValidElement<{ children?: React.ReactNode }>(child) && child.props.children) {
      return React.cloneElement(
        child,
        undefined,
        highlightPaths(child.props.children, validatedPaths)
      );
    }

    return child;
  });
}

/**
 * Creates markdown components for user bubble rendering.
 * Uses chat-user CSS variables for consistent styling and wraps
 * text-bearing elements through highlightPaths for @path tag injection
 * and optional search term highlighting.
 */
function createUserMarkdownComponents(
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
      <h1 className="mt-6 mb-3 text-lg font-semibold text-[var(--chat-user-text)] first:mt-0">
        {hl(children)}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-5 mb-2 text-base font-semibold text-[var(--chat-user-text)] first:mt-0">
        {hl(children)}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-4 mb-2 text-sm font-semibold text-[var(--chat-user-text)] first:mt-0">
        {hl(children)}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="mt-3 mb-1.5 text-sm font-semibold text-[var(--chat-user-text)] first:mt-0">
        {hl(children)}
      </h4>
    ),
    h5: ({ children }) => (
      <h5 className="mt-2 mb-1 text-sm font-medium text-[var(--chat-user-text)] first:mt-0">
        {hl(children)}
      </h5>
    ),
    h6: ({ children }) => (
      <h6 className="mt-2 mb-1 text-xs font-medium text-[var(--chat-user-text)] first:mt-0">
        {hl(children)}
      </h6>
    ),

    p: ({ children }) => (
      <p className="my-2 text-sm leading-relaxed text-[var(--chat-user-text)] first:mt-0 last:mb-0">
        {hl(children)}
      </p>
    ),

    // Inline elements — no hl(); parent block element's hl() descends here
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-[var(--chat-user-tag-text)] no-underline hover:underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),

    strong: ({ children }) => (
      <strong className="font-semibold text-[var(--chat-user-text)]">{children}</strong>
    ),

    em: ({ children }) => <em className="text-[var(--chat-user-text)] italic">{children}</em>,

    del: ({ children }) => (
      <del className="text-[var(--chat-user-text)] line-through">{children}</del>
    ),

    code: ({ className, children }) => {
      const hasLanguageClass = className?.includes('language-');
      const content = typeof children === 'string' ? children : '';
      const isMultiLine = content.includes('\n');
      const isBlock = (hasLanguageClass ?? false) || isMultiLine;

      if (isBlock) {
        return (
          <code className="block font-mono text-xs text-[var(--chat-user-text)]">
            {hl(children)}
          </code>
        );
      }
      // Inline code — no hl()
      return (
        <code className="rounded-sm border border-[var(--chat-user-tag-border)] bg-[var(--chat-user-tag-bg)] px-1.5 py-0.5 font-mono text-xs text-[var(--chat-user-tag-text)]">
          {children}
        </code>
      );
    },

    pre: ({ children }) => (
      <pre className="my-3 overflow-x-auto rounded-lg border border-[var(--chat-user-tag-border)] bg-[rgba(0,0,0,0.15)] p-3 font-mono text-xs leading-relaxed text-[var(--chat-user-text)]">
        {children}
      </pre>
    ),

    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-4 border-[var(--chat-user-tag-border)] pl-4 text-[var(--chat-user-text)] italic">
        {hl(children)}
      </blockquote>
    ),

    ul: ({ children }) => (
      <ul className="my-2 list-disc space-y-1 pl-5 text-[var(--chat-user-text)]">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 list-decimal space-y-1 pl-5 text-[var(--chat-user-text)]">{children}</ol>
    ),
    li: ({ children }) => <li className="text-sm text-[var(--chat-user-text)]">{hl(children)}</li>,

    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table className="min-w-full border-collapse border-[var(--chat-user-tag-border)] text-sm">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-[rgba(0,0,0,0.1)]">{children}</thead>,
    th: ({ children }) => (
      <th className="border border-[var(--chat-user-tag-border)] px-3 py-2 text-left font-semibold text-[var(--chat-user-text)]">
        {hl(children)}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-[var(--chat-user-tag-border)] px-3 py-2 text-[var(--chat-user-text)]">
        {hl(children)}
      </td>
    ),

    hr: () => <hr className="my-4 border-[var(--chat-user-tag-border)]" />,
  };
}

/**
 * UserChatGroup displays a user's input message.
 * Features:
 * - Right-aligned bubble layout with subtle blue styling
 * - Header with user icon, label, and timestamp
 * - Markdown rendering with inline highlighted mentions (@paths)
 * - Copy button on hover
 * - Toggle for long content (>500 chars)
 * - Shows image count indicator
 */
const UserChatGroupInner = ({ userGroup }: Readonly<UserChatGroupProps>): React.JSX.Element => {
  const { content, timestamp, id: groupId } = userGroup;
  const [isManuallyExpanded, setIsManuallyExpanded] = useState(false);
  const [validatedPaths, setValidatedPaths] = useState<Record<string, boolean>>({});

  // Get projectPath from per-tab session data, falling back to global state
  const { tabId } = useTabUI();
  const projectPath = useStore((s) => {
    const td = tabId ? s.tabSessionData[tabId] : null;
    return (td?.sessionDetail ?? s.sessionDetail)?.session?.projectPath;
  });

  // Get search state for highlighting — only re-render if THIS item has matches
  const { searchQuery, searchMatches, currentSearchIndex } = useStore(
    useShallow((s) => {
      const hasMatch = s.searchMatchItemIds.has(groupId);
      return {
        searchQuery: hasMatch ? s.searchQuery : '',
        searchMatches: hasMatch ? s.searchMatches : EMPTY_SEARCH_MATCHES,
        currentSearchIndex: hasMatch ? s.currentSearchIndex : -1,
      };
    })
  );

  const hasImages = content.images.length > 0;
  // Use rawText to preserve /commands inline
  const textContent = content.rawText ?? content.text ?? '';
  const isLongContent = textContent.length > 500;

  // Extract @path mentions from text
  const pathMentions = useMemo(() => {
    if (!textContent) return [];
    const result: { value: string; raw: string }[] = [];
    const pathPattern = new RegExp(PATH_PATTERN.source, PATH_PATTERN.flags);
    let match;
    while ((match = pathPattern.exec(textContent)) !== null) {
      result.push({ value: match[1], raw: match[0] });
    }
    return result;
  }, [textContent]);

  // Validate @path mentions via IPC
  useEffect(() => {
    if (pathMentions.length === 0 || !projectPath) return;
    let isCurrent = true;

    const validatePaths = async (): Promise<void> => {
      try {
        const toValidate = pathMentions.map((m) => ({ type: 'path' as const, value: m.value }));
        const results = await api.validateMentions(toValidate, projectPath);
        if (isCurrent) {
          setValidatedPaths(results);
        }
      } catch (err) {
        logger.error('Path validation failed:', err);
        if (isCurrent) {
          setValidatedPaths({});
        }
      }
    };

    void validatePaths();
    return () => {
      isCurrent = false;
    };
  }, [textContent, projectPath, pathMentions]);

  const effectiveValidatedPaths = useMemo(
    () => (pathMentions.length === 0 || !projectPath ? {} : validatedPaths),
    [pathMentions.length, projectPath, validatedPaths]
  );

  // Create search context (fresh each render so counter starts at 0)
  const searchCtx = searchQuery
    ? createSearchContext(searchQuery, groupId, searchMatches, currentSearchIndex)
    : null;

  // Base markdown components (no search) — safe to memoize
  const userMarkdownComponentsBase = useMemo(
    () => createUserMarkdownComponents(effectiveValidatedPaths, null),
    [effectiveValidatedPaths]
  );
  // When search is active, create fresh each render (match counter is stateful and must start at 0)
  // useMemo would cache stale closures when parent re-renders without search deps changing
  const userMarkdownComponents = searchCtx
    ? createUserMarkdownComponents(effectiveValidatedPaths, searchCtx)
    : userMarkdownComponentsBase;

  // Auto-expand when search is active and this message has ANY matches.
  // Without this, the pre-counter searches full text but the renderer only
  // shows the first 500 chars — creating phantom matches.
  const shouldAutoExpand = useMemo(() => {
    if (!searchQuery || !isLongContent) return false;
    return searchMatches.some((m) => m.itemId === groupId);
  }, [searchQuery, isLongContent, searchMatches, groupId]);

  // Combined expansion state: manual toggle or auto-expand for search
  const isExpanded = isManuallyExpanded || shouldAutoExpand;

  // Determine display text
  const displayText =
    isLongContent && !isExpanded ? textContent.slice(0, 500) + '...' : textContent;

  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-2">
        {/* Header - right aligned with improved hierarchy */}
        <div className="flex items-center justify-end gap-1.5">
          <span className="text-text-muted text-[10px]">{format(timestamp, 'h:mm:ss a')}</span>
          <span className="text-text-secondary text-xs font-semibold">You</span>
          <User className="text-text-secondary size-3.5" />
        </div>

        {/* Content - polished bubble with subtle depth */}
        {textContent && (
          <div
            className="group relative overflow-hidden rounded-2xl rounded-br-sm border border-[var(--chat-user-border)] bg-[var(--chat-user-bg)] px-4 py-3 shadow-[var(--chat-user-shadow)]"
          >
            <CopyButton text={textContent} bgColor="var(--chat-user-bg)" />

            <div className="text-sm text-[var(--chat-user-text)]" data-search-content>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={userMarkdownComponents}>
                {displayText}
              </ReactMarkdown>
            </div>
            {isLongContent && (
              <button
                onClick={() => setIsManuallyExpanded(!isManuallyExpanded)}
                className="text-text-muted mt-2 text-xs underline hover:opacity-80"
              >
                {isExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}

        {/* Images indicator */}
        {hasImages && (
          <div className="text-text-muted text-right text-xs">
            {content.images.length} image{content.images.length > 1 ? 's' : ''} attached
          </div>
        )}
      </div>
    </div>
  );
};

export const UserChatGroup = React.memo(UserChatGroupInner);
