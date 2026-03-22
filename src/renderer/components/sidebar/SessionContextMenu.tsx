/**
 * SessionContextMenu - Right-click context menu content for sidebar session items.
 * Uses shadcn ContextMenu primitives.
 * Supports opening in current pane, new tab, and split right.
 * Shows keyboard shortcut hints for actions that have them.
 */

import { useState } from 'react';

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from '@renderer/components/ui/context-menu';
import { MAX_PANES } from '@renderer/types/panes';
import { formatShortcut } from '@renderer/utils/stringUtils';
import { Check, ClipboardCopy, Eye, EyeOff, Pin, PinOff, Terminal } from 'lucide-react';

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
}: SessionContextMenuProps): React.JSX.Element => {
  const [copiedField, setCopiedField] = useState<'id' | 'command' | null>(null);

  const atMaxPanes = paneCount >= MAX_PANES;

  const handleCopy = (text: string, field: 'id' | 'command') => async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 600);
    } catch {
      // Silently fail
    }
  };

  return (
    <ContextMenuContent>
      <ContextMenuItem onClick={onOpenInCurrentPane}>
        Open in Current Pane
      </ContextMenuItem>
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

      <ContextMenuSeparator />

      <ContextMenuItem onClick={handleCopy(sessionId, 'id')}>
        {copiedField === 'id' ? (
          <Check className="size-4 text-green-400" />
        ) : (
          <ClipboardCopy className="size-4" />
        )}
        {copiedField === 'id' ? 'Copied!' : 'Copy Session ID'}
      </ContextMenuItem>
      <ContextMenuItem onClick={handleCopy(`claude --resume ${sessionId}`, 'command')}>
        {copiedField === 'command' ? (
          <Check className="size-4 text-green-400" />
        ) : (
          <Terminal className="size-4" />
        )}
        {copiedField === 'command' ? 'Copied!' : 'Copy Resume Command'}
      </ContextMenuItem>
    </ContextMenuContent>
  );
};
