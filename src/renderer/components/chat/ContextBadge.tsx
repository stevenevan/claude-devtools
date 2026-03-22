import React, { useMemo, useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover';
import { Separator } from '@renderer/components/ui/separator';
import {
  COLOR_BORDER,
  COLOR_BORDER_SUBTLE,
  COLOR_SURFACE_RAISED,
  COLOR_TEXT,
  COLOR_TEXT_MUTED,
  COLOR_TEXT_SECONDARY,
} from '@renderer/constants/cssVariables';
import { resolveAbsolutePath, shortenDisplayPath } from '@renderer/utils/pathDisplay';
import { formatTokensCompact as formatTokens } from '@shared/utils/tokenFormatting';
import { ChevronRight } from 'lucide-react';

import { CopyablePath } from '../common/CopyablePath';

import type {
  ClaudeMdContextInjection,
  ContextInjection,
  ContextStats,
  MentionedFileInjection,
  TaskCoordinationInjection,
  ThinkingTextInjection,
  ToolOutputInjection,
  UserMessageInjection,
} from '@renderer/types/contextInjection';

interface ContextBadgeProps {
  stats: ContextStats;
  projectRoot?: string;
}

function isClaudeMdInjection(inj: ContextInjection): inj is ClaudeMdContextInjection {
  return inj.category === 'claude-md';
}

function isMentionedFileInjection(inj: ContextInjection): inj is MentionedFileInjection {
  return inj.category === 'mentioned-file';
}

function isToolOutputInjection(inj: ContextInjection): inj is ToolOutputInjection {
  return inj.category === 'tool-output';
}

function isThinkingTextInjection(inj: ContextInjection): inj is ThinkingTextInjection {
  return inj.category === 'thinking-text';
}

function isTaskCoordinationInjection(inj: ContextInjection): inj is TaskCoordinationInjection {
  return inj.category === 'task-coordination';
}

function isUserMessageInjection(inj: ContextInjection): inj is UserMessageInjection {
  return inj.category === 'user-message';
}

const PopoverSection = ({
  title,
  count,
  tokenCount,
  children,
  defaultExpanded = false,
}: Readonly<{
  title: string;
  count: number;
  tokenCount: number;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}>): React.ReactElement => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className="mb-1 flex cursor-pointer items-center gap-1 text-xs font-medium hover:opacity-80"
        style={{ color: COLOR_TEXT_MUTED }}
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            setExpanded(!expanded);
          }
        }}
      >
        <ChevronRight
          className={`size-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span>
          {title} ({count}) ~{formatTokens(tokenCount)} tokens
        </span>
      </div>
      {expanded && <div className="space-y-1.5 pl-4">{children}</div>}
    </div>
  );
};

export const ContextBadge = ({
  stats,
  projectRoot,
}: Readonly<ContextBadgeProps>): React.ReactElement | null => {
  const totalNew = useMemo(
    () =>
      stats.newCounts.claudeMd +
      stats.newCounts.mentionedFiles +
      stats.newCounts.toolOutputs +
      stats.newCounts.thinkingText +
      stats.newCounts.taskCoordination +
      stats.newCounts.userMessages,
    [stats.newCounts]
  );

  const newClaudeMdInjections = useMemo(
    () => stats.newInjections.filter(isClaudeMdInjection),
    [stats.newInjections]
  );

  const newMentionedFileInjections = useMemo(
    () => stats.newInjections.filter(isMentionedFileInjection),
    [stats.newInjections]
  );

  const newToolOutputInjections = useMemo(
    () => stats.newInjections.filter(isToolOutputInjection),
    [stats.newInjections]
  );

  const newThinkingTextInjections = useMemo(
    () => stats.newInjections.filter(isThinkingTextInjection),
    [stats.newInjections]
  );

  const newTaskCoordinationInjections = useMemo(
    () => stats.newInjections.filter(isTaskCoordinationInjection),
    [stats.newInjections]
  );

  const newUserMessageInjections = useMemo(
    () => stats.newInjections.filter(isUserMessageInjection),
    [stats.newInjections]
  );

  const totalNewTokens = useMemo(
    () => stats.newInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [stats.newInjections]
  );

  const claudeMdTokens = useMemo(
    () => newClaudeMdInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [newClaudeMdInjections]
  );

  const mentionedFileTokens = useMemo(
    () => newMentionedFileInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [newMentionedFileInjections]
  );

  const toolOutputTokens = useMemo(
    () => newToolOutputInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [newToolOutputInjections]
  );

  const thinkingTextTokens = useMemo(
    () => newThinkingTextInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [newThinkingTextInjections]
  );

  const taskCoordinationTokens = useMemo(
    () => newTaskCoordinationInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [newTaskCoordinationInjections]
  );

  const toolOutputCount = useMemo(
    () => newToolOutputInjections.reduce((sum, inj) => sum + inj.toolCount, 0),
    [newToolOutputInjections]
  );

  const taskCoordinationCount = useMemo(
    () => newTaskCoordinationInjections.reduce((sum, inj) => sum + inj.breakdown.length, 0),
    [newTaskCoordinationInjections]
  );

  const userMessageTokens = useMemo(
    () => newUserMessageInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [newUserMessageInjections]
  );

  const badgeStyle: React.CSSProperties = {
    backgroundColor: COLOR_SURFACE_RAISED,
    border: `1px solid ${COLOR_BORDER}`,
    color: COLOR_TEXT_SECONDARY,
  };

  if (totalNew === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger className="inline-flex">
        <span
          className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
          style={badgeStyle}
        >
          <span>Context</span>
          <span className="font-semibold">+{totalNew}</span>
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-h-96 overflow-y-auto p-3" align="start">
        <div
          className="mb-2 pb-2 text-xs font-semibold"
          style={{
            color: COLOR_TEXT,
            borderBottom: `1px solid ${COLOR_BORDER_SUBTLE}`,
          }}
        >
          New Context Injected In This Turn
        </div>

        <div className="space-y-3">
          {newUserMessageInjections.length > 0 && (
            <PopoverSection
              title="User Messages"
              count={newUserMessageInjections.length}
              tokenCount={userMessageTokens}
            >
              {newUserMessageInjections.map((injection) => (
                <div key={injection.id} className="min-w-0">
                  <div className="flex items-center justify-between text-xs">
                    <span style={{ color: COLOR_TEXT_SECONDARY }}>
                      Turn {injection.turnIndex + 1}
                    </span>
                    <span style={{ color: COLOR_TEXT_MUTED }}>
                      ~{formatTokens(injection.estimatedTokens)} tokens
                    </span>
                  </div>
                  {injection.textPreview && (
                    <div
                      className="mt-0.5 truncate text-xs italic"
                      style={{ color: COLOR_TEXT_MUTED, opacity: 0.8 }}
                    >
                      {injection.textPreview}
                    </div>
                  )}
                </div>
              ))}
            </PopoverSection>
          )}

          {newClaudeMdInjections.length > 0 && (
            <PopoverSection
              title="CLAUDE.md Files"
              count={newClaudeMdInjections.length}
              tokenCount={claudeMdTokens}
            >
              {newClaudeMdInjections.map((injection) => {
                const displayPath =
                  shortenDisplayPath(injection.path, projectRoot) || injection.displayName;
                const absolutePath = resolveAbsolutePath(injection.path, projectRoot);
                return (
                  <div key={injection.id} className="min-w-0">
                    <CopyablePath
                      displayText={displayPath}
                      copyText={absolutePath}
                      className="text-xs"
                      style={{ color: COLOR_TEXT_SECONDARY }}
                    />
                    <div className="text-xs" style={{ color: COLOR_TEXT_MUTED }}>
                      ~{formatTokens(injection.estimatedTokens)} tokens
                    </div>
                  </div>
                );
              })}
            </PopoverSection>
          )}

          {newMentionedFileInjections.length > 0 && (
            <PopoverSection
              title="Mentioned Files"
              count={newMentionedFileInjections.length}
              tokenCount={mentionedFileTokens}
            >
              {newMentionedFileInjections.map((injection) => {
                const displayPath = shortenDisplayPath(injection.path, projectRoot);
                const absolutePath = resolveAbsolutePath(injection.path, projectRoot);
                return (
                  <div key={injection.id} className="min-w-0">
                    <CopyablePath
                      displayText={displayPath}
                      copyText={absolutePath}
                      className="text-xs"
                      style={{ color: COLOR_TEXT_SECONDARY }}
                    />
                    <div className="text-xs" style={{ color: COLOR_TEXT_MUTED }}>
                      ~{formatTokens(injection.estimatedTokens)} tokens
                    </div>
                  </div>
                );
              })}
            </PopoverSection>
          )}

          {newToolOutputInjections.length > 0 && (
            <PopoverSection
              title="Tool Outputs"
              count={toolOutputCount}
              tokenCount={toolOutputTokens}
            >
              {newToolOutputInjections.map((injection) =>
                injection.toolBreakdown.map((tool, idx) => (
                  <div
                    key={`${injection.id}-${tool.toolName}-${idx}`}
                    className="flex items-center justify-between text-xs"
                  >
                    <span style={{ color: COLOR_TEXT_SECONDARY }}>{tool.toolName}</span>
                    <span style={{ color: COLOR_TEXT_MUTED }}>
                      ~{formatTokens(tool.tokenCount)} tokens
                    </span>
                  </div>
                ))
              )}
            </PopoverSection>
          )}

          {newTaskCoordinationInjections.length > 0 && (
            <PopoverSection
              title="Task Coordination"
              count={taskCoordinationCount}
              tokenCount={taskCoordinationTokens}
            >
              {newTaskCoordinationInjections.map((injection) =>
                injection.breakdown.map((item, idx) => (
                  <div
                    key={`${injection.id}-${item.label}-${idx}`}
                    className="flex items-center justify-between text-xs"
                  >
                    <span style={{ color: COLOR_TEXT_SECONDARY }}>{item.label}</span>
                    <span style={{ color: COLOR_TEXT_MUTED }}>
                      ~{formatTokens(item.tokenCount)} tokens
                    </span>
                  </div>
                ))
              )}
            </PopoverSection>
          )}

          {newThinkingTextInjections.length > 0 && (
            <PopoverSection
              title="Thinking + Text"
              count={newThinkingTextInjections.length}
              tokenCount={thinkingTextTokens}
            >
              {newThinkingTextInjections.map((injection) => (
                <div key={injection.id} className="min-w-0">
                  <div className="text-xs" style={{ color: COLOR_TEXT_SECONDARY }}>
                    Turn {injection.turnIndex + 1}
                  </div>
                  <div className="space-y-0.5 pl-2">
                    {injection.breakdown.map((item, idx) => (
                      <div
                        key={`${item.type}-${idx}`}
                        className="flex items-center justify-between text-xs"
                      >
                        <span style={{ color: COLOR_TEXT_MUTED }}>
                          {item.type === 'thinking' ? 'Thinking' : 'Text'}
                        </span>
                        <span style={{ color: COLOR_TEXT_MUTED }}>
                          ~{formatTokens(item.tokenCount)} tokens
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </PopoverSection>
          )}
        </div>

        <div
          className="mt-2 flex items-center justify-between pt-2 text-xs"
          style={{ borderTop: `1px solid ${COLOR_BORDER_SUBTLE}` }}
        >
          <span style={{ color: COLOR_TEXT_MUTED }}>Total new tokens</span>
          <span style={{ color: COLOR_TEXT_SECONDARY }}>
            ~{formatTokens(totalNewTokens)} tokens
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
};
