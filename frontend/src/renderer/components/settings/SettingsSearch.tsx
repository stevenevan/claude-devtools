import { JSX, useMemo, useState } from 'react';
import { isDesktopMode } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Search } from 'lucide-react';

import {
  filterSettingsSearchItems,
  getSettingsSearchTarget,
  SETTINGS_SEARCH_ITEMS,
} from './settingsSearchRegistry';

import type { SettingsSearchItem } from './settingsSearchRegistry';
import type { SettingsSection } from './SettingsTabs';

interface SettingsSearchProps {
  readonly onNavigate: (section: SettingsSection, anchorId: string) => void;
}

export const SettingsSearch = ({ onNavigate }: SettingsSearchProps): JSX.Element => {
  const [query, setQuery] = useState('');
  const isDesktop = isDesktopMode();
  const visibleItems = useMemo(
    () => SETTINGS_SEARCH_ITEMS.filter((item) => !item.desktopOnly || isDesktop),
    [isDesktop]
  );
  const results = useMemo(
    () => filterSettingsSearchItems(query, visibleItems),
    [query, visibleItems]
  );

  const handleSelect = (item: SettingsSearchItem): void => {
    const target = getSettingsSearchTarget(item);
    setQuery('');
    onNavigate(target.section, target.anchorId);
  };

  return (
    <div className="relative mb-4">
      <Search
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
      />
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search settings…"
        aria-label="Search settings"
        className="h-8 pl-8"
      />
      {query.trim() && (
        <div className="border-border bg-popover absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border p-1 shadow-lg">
          {results.length > 0 ? (
            <ul aria-label="Settings search results" className="space-y-0.5">
              {results.map((item) => (
                <li key={item.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto w-full justify-between gap-3 px-2 py-1.5 text-left"
                    onClick={() => handleSelect(item)}
                  >
                    <span className="truncate">{item.label}</span>
                    <span className="text-muted-foreground shrink-0 text-[10px]">
                      {item.sectionLabel}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground px-2 py-2 text-xs">No matching settings.</p>
          )}
        </div>
      )}
    </div>
  );
};
