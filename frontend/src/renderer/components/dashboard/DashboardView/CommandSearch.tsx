import { JSX, useEffect, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { formatShortcut } from '@renderer/utils/stringUtils';
import { Command, Search } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

interface CommandSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export const CommandSearch = ({
  value,
  onChange,
  placeholder = 'Search projects...',
}: Readonly<CommandSearchProps>): JSX.Element => {
  const [isFocused, setIsFocused] = useState(false);
  const { openCommandPalette, selectedProjectId } = useStore(
    useShallow((s) => ({
      openCommandPalette: s.openCommandPalette,
      selectedProjectId: s.selectedProjectId,
    }))
  );

  // Handle Cmd+K to open full command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openCommandPalette();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openCommandPalette]);

  return (
    <div className="relative mx-auto w-full max-w-xl">
      {/* Search container with glow effect on focus */}
      <div
        className={cn(
          'bg-card relative flex items-center gap-3 rounded-xs border px-4 py-3 transition-all duration-200',
          isFocused
            ? 'border-zinc-500 shadow-[0_0_20px_rgba(255,255,255,0.04)] ring-1 ring-zinc-600/30'
            : 'border-border hover:border-zinc-600'
        )}
      >
        <Search className="text-muted-foreground size-4 shrink-0" />
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="text-foreground placeholder:text-muted-foreground h-auto flex-1 border-0 bg-transparent px-0 py-0 text-sm shadow-none outline-hidden focus-visible:border-0 focus-visible:ring-0"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
        {/* Keyboard shortcut badge - opens full command palette */}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => openCommandPalette()}
          className="shrink-0 gap-1 p-0 transition-opacity hover:opacity-80"
          title={
            selectedProjectId
              ? `Search in sessions (${formatShortcut('K')})`
              : `Search projects (${formatShortcut('K')})`
          }
        >
          <kbd className="border-border bg-popover text-muted-foreground flex h-5 items-center justify-center rounded-sm border px-1.5 text-[10px] font-medium">
            <Command className="size-2.5" />
          </kbd>
          <kbd className="border-border bg-popover text-muted-foreground flex size-5 items-center justify-center rounded-sm border text-[10px] font-medium">
            K
          </kbd>
        </Button>
      </div>
    </div>
  );
};
