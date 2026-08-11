import { JSX, useEffect, useMemo, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@renderer/components/ui/combobox';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { FolderOpen, GitBranch, X } from 'lucide-react';

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
}: Readonly<RepositoryDropdownProps>): JSX.Element => {
  const [open, setOpen] = useState(false);

  const repositoryGroups = useStore((state) => state.repositoryGroups);
  const repositoryGroupsLoading = useStore((state) => state.repositoryGroupsLoading);
  const repositoryGroupsError = useStore((state) => state.repositoryGroupsError);
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

  const itemById = useMemo(
    () => new Map(availableItems.map((item) => [item.id, item] as const)),
    [availableItems]
  );

  const handleSelect = (id: string | null): void => {
    if (!id) return;
    const item = itemById.get(id);
    if (!item) return;
    onSelect(item);
    setOpen(false);
  };

  const isEmpty = availableItems.length === 0;
  const inputDisabled =
    disabled || (isEmpty && !repositoryGroupsLoading && repositoryGroupsError === null);

  return (
    <Combobox
      items={availableItems.map((item) => item.id)}
      itemToStringLabel={(id) => itemById.get(id)?.name ?? id}
      open={open}
      onOpenChange={setOpen}
      onValueChange={(id) => handleSelect(id)}
      disabled={inputDisabled}
      autoHighlight
      aria-label={placeholder}
    >
      <div className={cn('relative', className)}>
        <FolderOpen
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2"
          aria-hidden="true"
        />
        <ComboboxInput
          placeholder={
            repositoryGroupsLoading
              ? 'Loading repositories…'
              : isEmpty
                ? 'No repositories available'
                : placeholder
          }
          disabled={inputDisabled}
          className="w-full pl-7"
        />
      </div>
      <ComboboxContent side={dropUp ? 'top' : 'bottom'} align="start" className="w-(--anchor-width)">
        <ComboboxList>
          {availableItems.map((item) => (
            <RepositoryDropdownItemComponent key={item.id} item={item} />
          ))}
          <ComboboxEmpty>
            {repositoryGroupsLoading
              ? 'Loading repositories…'
              : isEmpty
                ? (repositoryGroupsError ?? 'No repositories available')
                : 'No matching repositories'}
          </ComboboxEmpty>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
};

const RepositoryDropdownItemComponentInner = ({
  item,
}: Readonly<{
  item: RepositoryDropdownItem;
}>): JSX.Element => {
  return (
    <ComboboxItem
      value={item.id}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors"
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
    </ComboboxItem>
  );
};

const RepositoryDropdownItemComponent = RepositoryDropdownItemComponentInner;

const SelectedRepositoryItemInner = ({
  item,
  onRemove,
  disabled = false,
}: Readonly<{
  item: RepositoryDropdownItem;
  onRemove: () => void;
  disabled?: boolean;
}>): JSX.Element => {
  return (
    <div className="border-border/50 flex items-center gap-2 border-b py-1.5">
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
        aria-label={`Remove repository ${item.name}`}
      >
        <X className="size-3" />
      </Button>
    </div>
  );
};

export const SelectedRepositoryItem = SelectedRepositoryItemInner;
