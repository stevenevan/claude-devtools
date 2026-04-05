/**
 * SessionContextMenu - Right-click context menu content for sidebar session items.
 * Uses shadcn ContextMenu primitives.
 * Supports opening in current pane, new tab, and split right.
 * Shows keyboard shortcut hints for actions that have them.
 */

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from '@renderer/components/ui/context-menu';
import { useClipboard } from '@renderer/hooks/mantine';
import { MAX_PANES } from '@renderer/types/panes';
import { formatShortcut } from '@renderer/utils/stringUtils';
import { ArrowLeftRight, Check, ClipboardCopy, Eye, EyeOff, Pin, PinOff, Tag, Terminal } from 'lucide-react';

import { SessionTagEditor } from './SessionTagEditor';

interface SessionContextMenuProps {
  sessionId: string;
  paneCount: number;
  isPinned: boolean;
  isHidden: boolean;
  onOpenInCurrentPane: () => void;
  onOpenInNewTab: () => void;
  onSplitRightAndOpen: () => void;
  onTogglePin: () => void;
  onToggleHide: () => void;
  onCompareWith?: () => void;
}

export const SessionContextMenu = ({
  sessionId,
  paneCount,
  isPinned,
  isHidden,
  onOpenInCurrentPane,
  onOpenInNewTab,
  onSplitRightAndOpen,
  onTogglePin,
  onToggleHide,
  onCompareWith,
}: SessionContextMenuProps): React.JSX.Element => {
  const idClipboard = useClipboard({ timeout: 600 });
  const cmdClipboard = useClipboard({ timeout: 600 });

  const atMaxPanes = paneCount >= MAX_PANES;

  return (
    <ContextMenuContent>
      <ContextMenuItem onClick={onOpenInCurrentPane}>Open in Current Pane</ContextMenuItem>
      <ContextMenuItem onClick={onOpenInNewTab}>
        Open in New Tab
        <ContextMenuShortcut>{`${formatShortcut('')}Click`}</ContextMenuShortcut>
      </ContextMenuItem>

      <ContextMenuSeparator />

      <ContextMenuItem onClick={onSplitRightAndOpen} disabled={atMaxPanes}>
        Split Right and Open
      </ContextMenuItem>

      <ContextMenuSeparator />

      <ContextMenuItem onClick={onTogglePin}>
        {isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        {isPinned ? 'Unpin Session' : 'Pin Session'}
      </ContextMenuItem>
      <ContextMenuItem onClick={onToggleHide}>
        {isHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        {isHidden ? 'Unhide Session' : 'Hide Session'}
      </ContextMenuItem>

      {onCompareWith && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onCompareWith}>
            <ArrowLeftRight className="size-4" />
            Compare with Current Session
          </ContextMenuItem>
        </>
      )}

      <ContextMenuSeparator />

      <div className="px-2 py-1.5">
        <div className="text-muted-foreground mb-1 flex items-center gap-1 text-[10px] font-medium">
          <Tag className="size-2.5" />
          Tags
        </div>
        <SessionTagEditor sessionId={sessionId} />
      </div>

      <ContextMenuSeparator />

      <ContextMenuItem onClick={() => idClipboard.copy(sessionId)}>
        {idClipboard.copied ? (
          <Check className="size-4 text-green-400" />
        ) : (
          <ClipboardCopy className="size-4" />
        )}
        {idClipboard.copied ? 'Copied!' : 'Copy Session ID'}
      </ContextMenuItem>
      <ContextMenuItem onClick={() => cmdClipboard.copy(`claude --resume ${sessionId}`)}>
        {cmdClipboard.copied ? (
          <Check className="size-4 text-green-400" />
        ) : (
          <Terminal className="size-4" />
        )}
        {cmdClipboard.copied ? 'Copied!' : 'Copy Resume Command'}
      </ContextMenuItem>
    </ContextMenuContent>
  );
};
