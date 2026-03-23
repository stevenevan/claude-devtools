/**
 * WorkspaceIndicator - Floating bottom-right pill badge for workspace switching.
 *
 * Shows active workspace (Local or SSH host) with connection status badge.
 * Clicking opens an upward popover to switch between available workspaces.
 * Only renders when multiple contexts are available (hidden in local-only mode).
 */

import { useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { Check, ChevronDown } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { ConnectionStatusBadge } from './ConnectionStatusBadge';

export const WorkspaceIndicator = (): React.JSX.Element | null => {
  const { activeContextId, isContextSwitching, availableContexts, switchContext } = useStore(
    useShallow((s) => ({
      activeContextId: s.activeContextId,
      isContextSwitching: s.isContextSwitching,
      availableContexts: s.availableContexts,
      switchContext: s.switchContext,
    }))
  );

  const [isOpen, setIsOpen] = useState(false);

  // Only show when multiple contexts exist
  if (availableContexts.length <= 1) return null;

  const getContextLabel = (contextId: string): string => {
    if (contextId === 'local') return 'Local';
    return contextId.startsWith('ssh-') ? contextId.slice(4) : contextId;
  };

  const activeLabel = getContextLabel(activeContextId);

  return (
    <div className="fixed right-4 bottom-4 z-30">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger
          disabled={isContextSwitching}
          className={cn(
            'flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs shadow-lg transition-opacity hover:opacity-90',
            isContextSwitching && 'opacity-50'
          )}
        >
          <ConnectionStatusBadge contextId={activeContextId} />
          <span
            className={cn(
              'font-medium',
              isContextSwitching ? 'text-muted-foreground' : 'text-foreground'
            )}
          >
            {activeLabel}
          </span>
          <ChevronDown
            className={cn(
              'size-3 text-muted-foreground transition-transform',
              isOpen && 'rotate-180'
            )}
          />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          sideOffset={8}
          align="end"
          className="bg-sidebar max-h-[250px] w-56 overflow-y-auto p-0 py-1"
        >
          <div className="text-muted-foreground px-3 py-2 text-[10px] font-semibold tracking-wider uppercase">
            Switch Workspace
          </div>
          {availableContexts.map((ctx) => {
            const isSelected = ctx.id === activeContextId;
            const label = getContextLabel(ctx.id);

            return (
              <ContextItem
                key={ctx.id}
                contextId={ctx.id}
                label={label}
                isSelected={isSelected}
                onSelect={() => {
                  void switchContext(ctx.id);
                  setIsOpen(false);
                }}
              />
            );
          })}
        </PopoverContent>
      </Popover>
    </div>
  );
};

interface ContextItemProps {
  contextId: string;
  label: string;
  isSelected: boolean;
  onSelect: () => void;
}

const ContextItem = ({
  contextId,
  label,
  isSelected,
  onSelect,
}: Readonly<ContextItemProps>): React.JSX.Element => {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
        isSelected ? 'bg-card' : 'hover:bg-card hover:opacity-50'
      )}
    >
      <ConnectionStatusBadge contextId={contextId} />
      <span
        className={cn(
          'flex-1 truncate text-sm',
          isSelected ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {label}
      </span>
      {isSelected && <Check className="size-3.5 shrink-0 text-indigo-400" />}
    </button>
  );
};
