/**
 * ShortcutCheatSheet - Modal overlay showing all keyboard shortcuts.
 * Opened via ? key. Organized by category.
 * Uses the Dialog component for proper focus trapping and ARIA semantics.
 */

import { useEffect } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';

interface ShortcutCheatSheetProps {
  open: boolean;
  onClose: () => void;
}

const isMac = navigator.platform.includes('Mac');
const mod = isMac ? '\u2318' : 'Ctrl';

interface ShortcutEntry {
  keys: string;
  description: string;
}

interface ShortcutSection {
  title: string;
  shortcuts: ShortcutEntry[];
}

const SECTIONS: ShortcutSection[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: `${mod}+K`, description: 'Open command palette' },
      { keys: `${mod}+Shift+F`, description: 'Advanced search' },
      { keys: `${mod}+,`, description: 'Open settings' },
      { keys: `${mod}+\\`, description: 'Toggle sidebar' },
      { keys: 'J / K', description: 'Next / previous AI turn' },
    ],
  },
  {
    title: 'Tabs',
    shortcuts: [
      { keys: 'Ctrl+Tab', description: 'Next tab' },
      { keys: 'Ctrl+Shift+Tab', description: 'Previous tab' },
      { keys: `${mod}+W`, description: 'Close tab' },
      { keys: `${mod}+Shift+W`, description: 'Close all tabs' },
    ],
  },
  {
    title: 'Session',
    shortcuts: [
      { keys: `${mod}+R`, description: 'Refresh session' },
      { keys: `${mod}+F`, description: 'Find in session' },
      { keys: `${mod}+G`, description: 'Next search match' },
      { keys: `${mod}+Shift+G`, description: 'Previous search match' },
    ],
  },
  {
    title: 'Panes',
    shortcuts: [
      { keys: `${mod}+Opt+\\`, description: 'Split pane' },
      { keys: `${mod}+Opt+W`, description: 'Close pane' },
      { keys: `${mod}+Opt+1-4`, description: 'Focus pane by index' },
    ],
  },
];

export const ShortcutCheatSheet = ({
  open,
  onClose,
}: Readonly<ShortcutCheatSheetProps>): React.JSX.Element => {
  // Also close on ? key (in addition to Escape handled by Dialog)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Keyboard Shortcuts</DialogTitle>
          <DialogDescription className="sr-only">
            List of available keyboard shortcuts organized by category
          </DialogDescription>
        </DialogHeader>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-6">
            {SECTIONS.map((section) => (
              <div key={section.title}>
                <h3 className="text-muted-foreground mb-2 text-[10px] font-medium uppercase tracking-wider">
                  {section.title}
                </h3>
                <div className="space-y-1.5">
                  {section.shortcuts.map((shortcut) => (
                    <div key={shortcut.keys} className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground text-xs">{shortcut.description}</span>
                      <kbd className="border-border bg-muted text-foreground shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[10px]">
                        {shortcut.keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-border border-t pt-2.5">
          <span className="text-muted-foreground text-[10px]">
            Press <kbd className="border-border bg-muted rounded-sm border px-1 font-mono text-[10px]">?</kbd> or{' '}
            <kbd className="border-border bg-muted rounded-sm border px-1 font-mono text-[10px]">Esc</kbd> to close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
};
