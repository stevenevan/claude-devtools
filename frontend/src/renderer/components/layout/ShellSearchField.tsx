import { JSX } from 'react';
import { Input } from '@renderer/components/ui/input';
import { useStore } from '@renderer/store';
import { Search, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '../ui/button';

export const ShellSearchField = (): JSX.Element => {
  const { query, setQuery, restorePreviousActivity } = useStore(
    useShallow((state) => ({
      query: state.shellSearchQuery,
      setQuery: state.setShellSearchQuery,
      restorePreviousActivity: state.restorePreviousActivity,
    }))
  );

  return (
    <div className="border-border bg-surface flex h-11 items-center border-b px-3">
      <div className="border-border bg-surface-raised focus-within:border-border-emphasis mx-auto flex w-full max-w-xl items-center gap-2 rounded-md border px-3">
        <Search className="text-text-muted size-4" aria-hidden="true" />
        <Input
          value={query}
          id="shell-search-input"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) restorePreviousActivity();
          }}
          aria-label="Search conversations"
          placeholder="Search conversations"
          className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
        />
        {query && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Clear search and return"
            onClick={restorePreviousActivity}
          >
            <X className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
};
