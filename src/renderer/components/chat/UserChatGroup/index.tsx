import React, { useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { useTabUI } from '@renderer/hooks/useTabUI';
import { useStore } from '@renderer/store';
import { createLogger } from '@shared/utils/logger';
import { format } from 'date-fns';
import { User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useShallow } from 'zustand/react/shallow';

import { CopyButton } from '../../common/CopyButton';

import { AnnotationBadge } from '../AnnotationBadge';
import { createSearchContext, EMPTY_SEARCH_MATCHES } from '../searchHighlightUtils';

import { createUserMarkdownComponents } from './userMarkdownComponents';

import type { UserGroup } from '@renderer/types/groups';

const logger = createLogger('Component:UserChatGroup');

// Pattern for @paths only (file references)
const PATH_PATTERN = /@([^\s,)}\]]+)/g;

interface UserChatGroupProps {
  userGroup: UserGroup;
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
        <div className="group flex items-center justify-end gap-1.5">
          <AnnotationBadge targetId={groupId} />
          <span className="text-muted-foreground text-[10px]">
            {format(timestamp, 'h:mm:ss a')}
          </span>
          <span className="text-muted-foreground text-xs font-semibold">You</span>
          <User className="text-muted-foreground size-3.5" />
        </div>

        {/* Content - polished bubble with subtle depth */}
        {textContent && (
          <div className="group border-border bg-card relative overflow-hidden rounded-2xl rounded-br-sm border px-4 py-3 shadow-sm">
            <CopyButton text={textContent} />

            <div className="text-muted-foreground text-sm" data-search-content>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={userMarkdownComponents}>
                {displayText}
              </ReactMarkdown>
            </div>
            {isLongContent && (
              <button
                onClick={() => setIsManuallyExpanded(!isManuallyExpanded)}
                className="text-muted-foreground mt-2 text-xs underline hover:opacity-80"
              >
                {isExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}

        {/* User-attached images */}
        {hasImages && (
          <div className="mt-2 space-y-1.5">
            <div className="text-muted-foreground text-right text-[10px]">
              {content.images.length} image{content.images.length > 1 ? 's' : ''} attached
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {content.images.map((img) => (
                <div key={img.id} className="border-border overflow-hidden rounded-lg border">
                  {img.data ? (
                    <img
                      src={`data:${img.mediaType};base64,${img.data}`}
                      alt="Attached by user"
                      className="max-h-64 max-w-full object-contain"
                      loading="lazy"
                    />
                  ) : (
                    <div className="bg-surface-raised text-muted-foreground flex h-20 w-32 items-center justify-center text-xs">
                      Image unavailable
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const UserChatGroup = React.memo(UserChatGroupInner);
