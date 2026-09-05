import type { JSX } from 'react';
import { CommandGroup, CommandItem } from '@renderer/components/ui/command';
import { Bot, User } from 'lucide-react';

import { SearchResultCard } from '../SearchResultCard';

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
            className="gap-3 px-0 py-0"
          >
            <SearchResultCard
              title={result.sessionTitle}
              snippet={result.context}
              query={result.matchedText}
              timestamp={result.timestamp}
              projectLabel={globalSearchEnabled ? projectName : undefined}
              badges={
                result.messageType === 'user' ? (
                  <User className="size-4 text-blue-400" aria-label="User message" />
                ) : (
                  <Bot className="size-4 text-green-400" aria-label="Assistant message" />
                )
              }
            />
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
};
