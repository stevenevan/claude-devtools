import type { JSX } from 'react';
import { CommandGroup, CommandItem } from '@renderer/components/ui/command';
import { cn } from '@renderer/lib/utils';
import { Bot, FileText, FolderGit2, User } from 'lucide-react';

import { highlightMatch } from './helpers';

import type { RepositoryGroup, SearchResult } from '@renderer/types/data';

interface SessionResultsProps {
  results: SearchResult[];
  globalSearchEnabled: boolean;
  repositoryGroups: RepositoryGroup[];
  onSelect: (result: SearchResult) => void;
}

export const SessionResults = ({
  results,
  globalSearchEnabled,
  repositoryGroups,
  onSelect,
}: SessionResultsProps): JSX.Element => {
  return (
    <CommandGroup heading="Results">
      {results.map((result, index) => {
        const projectName = globalSearchEnabled
          ? repositoryGroups.find((r) => r.worktrees.some((w) => w.id === result.projectId))?.name
          : undefined;

        return (
          <CommandItem
            key={`${result.sessionId}-${index}`}
            value={`${result.sessionId}-${index}`}
            onSelect={() => onSelect(result)}
            className="gap-3 px-4 py-3"
          >
            <div
              className={cn(
                'shrink-0',
                result.messageType === 'user' ? 'text-blue-400' : 'text-green-400'
              )}
            >
              {result.messageType === 'user' ? (
                <User className="size-4" />
              ) : (
                <Bot className="size-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              {globalSearchEnabled && projectName && (
                <div className="mb-1 flex items-center gap-2">
                  <FolderGit2 className="size-3 text-blue-400" />
                  <span className="truncate text-xs font-medium text-blue-400">{projectName}</span>
                </div>
              )}
              <div className="mb-1 flex items-center gap-2">
                <FileText className="text-muted-foreground size-3" />
                <span className="text-muted-foreground truncate text-xs">
                  {result.sessionTitle.slice(0, 60)}
                  {result.sessionTitle.length > 60 ? '...' : ''}
                </span>
              </div>
              <div className="text-foreground text-sm leading-relaxed">
                {highlightMatch(result.context, result.matchedText)}
              </div>
              <div className="text-muted-foreground/60 mt-1 text-xs">
                {new Date(result.timestamp).toLocaleDateString()}{' '}
                {new Date(result.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
};
