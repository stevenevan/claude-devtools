import { useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { MoreHorizontal, Star } from 'lucide-react';

import type { FilterPresetEntry } from '@shared/types/notifications';

interface Props {
  preset: FilterPresetEntry;
  index: number;
  isDefault: boolean;
  onApply: () => void;
  onRename: (next: string) => void;
  onDelete: () => void;
  onSetDefault: () => void;
}

export const PresetChip = ({
  preset,
  index,
  isDefault,
  onApply,
  onRename,
  onDelete,
  onSetDefault,
}: Readonly<Props>): React.JSX.Element => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(preset.name);

  const showShortcutBadge = index < 9;

  if (renaming) {
    return (
      <div className="border-border bg-background flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]">
        <input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const trimmed = draftName.trim();
              if (trimmed) onRename(trimmed);
              setRenaming(false);
            } else if (e.key === 'Escape') {
              setRenaming(false);
              setDraftName(preset.name);
            }
          }}
          onBlur={() => {
            const trimmed = draftName.trim();
            if (trimmed && trimmed !== preset.name) onRename(trimmed);
            setRenaming(false);
          }}
          className="text-foreground w-24 bg-transparent outline-none"
        />
      </div>
    );
  }

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={onApply}
        className={cn(
          'h-auto items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-normal',
          isDefault && 'border-primary/40 bg-primary/5'
        )}
        title={preset.name}
      >
        {showShortcutBadge && (
          <span className="bg-muted text-muted-foreground rounded px-1 font-mono text-[9px]">
            {index + 1}
          </span>
        )}
        {isDefault && <Star className="text-primary size-2.5" fill="currentColor" />}
        <span className="max-w-[10rem] truncate">{preset.name}</span>
        <span
          role="button"
          tabIndex={0}
          aria-label={`Preset menu: ${preset.name}`}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }
          }}
          className="hover:text-foreground inline-flex"
        >
          <MoreHorizontal className="size-3" />
        </span>
      </Button>

      {menuOpen && (
        <div
          className="border-border bg-popover text-popover-foreground absolute top-full left-0 z-30 mt-1 flex w-32 flex-col gap-0.5 rounded-md border p-1 text-[11px] shadow-lg"
          onMouseLeave={() => setMenuOpen(false)}
        >
          <Button
            variant="ghost"
            size="sm"
            className="h-6 justify-start px-2"
            onClick={() => {
              setRenaming(true);
              setMenuOpen(false);
            }}
          >
            Rename
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 justify-start px-2"
            onClick={() => {
              onSetDefault();
              setMenuOpen(false);
            }}
          >
            {isDefault ? 'Clear default' : 'Set default'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive h-6 justify-start px-2"
            onClick={() => {
              onDelete();
              setMenuOpen(false);
            }}
          >
            Delete
          </Button>
        </div>
      )}
    </div>
  );
};
