import React, { useEffect, useMemo, useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { ChevronDown, FolderOpen, GitBranch, X } from 'lucide-react';

import type { RepositoryDropdownItem } from '@renderer/components/settings/hooks/useSettingsConfig';

interface RepositoryDropdownProps {
  onSelect: (item: RepositoryDropdownItem) => void;
  excludeIds?: string[];
  placeholder?: string;
  disabled?: boolean;
  dropUp?: boolean;
  className?: string;
}

export const RepositoryDropdown = ({
  onSelect,
  excludeIds = [],
  placeholder = 'Select repository...',
  disabled = false,
  dropUp = false,
  className = '',
}: Readonly<RepositoryDropdownProps>): React.JSX.Element => {
  const [open, setOpen] = useState(false);

  const repositoryGroups = useStore((state) => state.repositoryGroups);
  const fetchRepositoryGroups = useStore((state) => state.fetchRepositoryGroups);

  useEffect(() => {
    if (repositoryGroups.length === 0) {
      void fetchRepositoryGroups();
    }
  }, [repositoryGroups.length, fetchRepositoryGroups]);

  const allItems = useMemo((): RepositoryDropdownItem[] => {
    return repositoryGroups.map((group) => ({
      id: group.id,
      name: group.name,
      path: group.worktrees[0]?.path ?? '',
      worktreeCount: group.worktrees.length,
      totalSessions: group.totalSessions,
    }));
  }, [repositoryGroups]);

  const availableItems = useMemo(() => {
    return allItems.filter((item) => !excludeIds.includes(item.id));
  }, [allItems, excludeIds]);

  const handleSelect = (item: RepositoryDropdownItem): void => {
    onSelect(item);
    setOpen(false);
  };

  const isEmpty = availableItems.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            disabled={disabled || isEmpty}
            className={cn('w-full justify-between text-xs', className)}
          />
        }
      >
        <span className="flex items-center gap-2">
          <FolderOpen className="size-3" />
          {isEmpty ? 'No repositories available' : placeholder}
        </span>
        <ChevronDown
          className={cn('size-4 transition-transform duration-200', open && 'rotate-180')}
        />
      </PopoverTrigger>
      <PopoverContent
        side={dropUp ? 'top' : 'bottom'}
        className="max-h-64 w-(--anchor-width) overflow-y-auto p-1"
      >
        {availableItems.map((item) => (
          <RepositoryDropdownItemComponent
            key={item.id}
            item={item}
            onSelect={() => handleSelect(item)}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
};

const RepositoryDropdownItemComponentInner = ({
  item,
  onSelect,
}: Readonly<{
  item: RepositoryDropdownItem;
  onSelect: () => void;
}>): React.JSX.Element => {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors"
    >
      <FolderOpen className="size-3 shrink-0 text-indigo-400" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground truncate text-xs">{item.name}</span>
          {item.worktreeCount > 1 && (
            <span className="bg-muted text-muted-foreground flex shrink-0 items-center gap-0.5 rounded-sm px-1 py-0.5 text-[10px]">
              <GitBranch className="size-2.5" />
              {item.worktreeCount}
            </span>
          )}
          <span className="text-muted-foreground shrink-0 text-[10px]">
            {item.totalSessions} session{item.totalSessions !== 1 ? 's' : ''}
          </span>
        </div>
        <span className="text-muted-foreground block truncate text-[10px]">{item.path}</span>
      </div>
    </button>
  );
};

const RepositoryDropdownItemComponent = React.memo(RepositoryDropdownItemComponentInner);

const SelectedRepositoryItemInner = ({
  item,
  onRemove,
  disabled = false,
}: Readonly<{
  item: RepositoryDropdownItem;
  onRemove: () => void;
  disabled?: boolean;
}>): React.JSX.Element => {
  return (
    <div className="border-border-subtle flex items-center gap-2 border-b py-1.5">
      <FolderOpen className="size-3 shrink-0 text-indigo-400" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground truncate text-xs">{item.name}</span>
          {item.worktreeCount > 1 && (
            <span className="bg-muted text-muted-foreground flex shrink-0 items-center gap-0.5 rounded-sm px-1 py-0.5 text-[10px]">
              <GitBranch className="size-2.5" />
              {item.worktreeCount}
            </span>
          )}
        </div>
        <span className="text-muted-foreground truncate text-[10px]" title={item.path}>
          {item.path}
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        disabled={disabled}
        className="shrink-0 hover:bg-red-500/10 hover:text-red-400"
        aria-label="Remove repository"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
};

export const SelectedRepositoryItem = React.memo(SelectedRepositoryItemInner);
