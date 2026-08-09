import { JSX, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { useStore } from '@renderer/store';
import { Settings } from 'lucide-react';

import { ConversationList } from '../ConversationList';

import { CommandSearch } from './CommandSearch';
import { ProjectsGrid } from './ProjectsGrid';

const NerdDashboardView = (): JSX.Element => {
  const [searchQuery, setSearchQuery] = useState('');
  const openSettingsTab = useStore((s) => s.openSettingsTab);

  return (
    <div className="bg-background relative flex-1 overflow-auto">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.08),transparent)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-5xl px-8 py-12">
        <div className="mb-8">
          <CommandSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search projects..."
          />
        </div>

        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            {searchQuery.trim() ? 'Search Results' : 'Recent Projects'}
          </h2>
          <div className="flex items-center gap-3">
            {searchQuery.trim() && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setSearchQuery('')}
                className="text-muted-foreground hover:text-foreground"
              >
                Clear search
              </Button>
            )}
            <Button
              variant="ghost"
              size="xs"
              onClick={() => openSettingsTab('general')}
              title="Change Claude data folder"
              className="text-muted-foreground hover:text-foreground gap-1.5"
            >
              <Settings className="size-3" />
              Change default folder
            </Button>
          </div>
        </div>

        <ProjectsGrid searchQuery={searchQuery} />
      </div>
    </div>
  );
};

export const DashboardView = (): JSX.Element => {
  const mode = useUIMode();

  return mode === 'simple' ? <ConversationList /> : <NerdDashboardView />;
};
