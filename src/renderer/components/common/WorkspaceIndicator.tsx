/**
 * WorkspaceIndicator - Floating bottom-right pill badge for workspace switching.
 *
 * Shows active workspace (Local or SSH host) with connection status badge.
 * Clicking opens an upward dropdown to switch between available workspaces.
 * Only renders when multiple contexts are available (hidden in local-only mode).
 */

import { useEffect } from 'react';

import { useClickOutside, useDisclosure } from '@renderer/hooks/mantine';
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

  const [isOpen, { close, toggle }] = useDisclosure(false);
  const dropdownRef = useClickOutside<HTMLDivElement>(close);

  // Close dropdown on Escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [close]);

  // Only show when multiple contexts exist
  if (availableContexts.length <= 1) return null;

  const getContextLabel = (contextId: string): string => {
    if (contextId === 'local') return 'Local';
    return contextId.startsWith('ssh-') ? contextId.slice(4) : contextId;
  };

  const activeLabel = getContextLabel(activeContextId);

  return (
    <div ref={dropdownRef} className="fixed right-4 bottom-4 z-30">
      {/* Trigger pill */}
      <button
        onClick={() => !isContextSwitching && toggle()}
        disabled={isContextSwitching}
        className={cn(
          'flex items-center gap-2 rounded-full border border-border-emphasis bg-surface-raised px-3 py-1.5 text-xs shadow-lg transition-opacity hover:opacity-90',
          isContextSwitching && 'opacity-50'
        )}
      >
        <ConnectionStatusBadge contextId={activeContextId} />
        <span className={cn('font-medium', isContextSwitching ? 'text-text-muted' : 'text-text')}>
          {activeLabel}
        </span>
        <ChevronDown
          className={cn('size-3 text-text-muted transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {/* Upward dropdown */}
      {isOpen && !isContextSwitching && (
        <>
          {/* Backdrop */}
          <div role="presentation" className="fixed inset-0 z-10" onClick={close} />

          {/* Dropdown content - opens upward */}
          <div className="border-border absolute right-0 bottom-full z-20 mb-2 max-h-[250px] w-56 overflow-y-auto rounded-lg border bg-[var(--color-surface-sidebar)] py-1 shadow-xl">
            {/* Header */}
            <div className="text-text-muted px-3 py-2 text-[10px] font-semibold tracking-wider uppercase">
              Switch Workspace
            </div>

            {/* Context list */}
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
                    close();
                  }}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

/**
 * Individual context item in the dropdown.
 */
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
        isSelected ? 'bg-surface-raised' : 'hover:bg-surface-raised hover:opacity-50'
      )}
    >
      <ConnectionStatusBadge contextId={contextId} />
      <span className={cn('flex-1 truncate text-sm', isSelected ? 'text-text' : 'text-text-muted')}>
        {label}
      </span>
      {isSelected && <Check className="size-3.5 shrink-0 text-indigo-400" />}
    </button>
  );
};
