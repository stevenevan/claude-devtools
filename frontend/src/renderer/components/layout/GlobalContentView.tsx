import { cloneElement, JSX, ReactElement, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { useStore } from '@renderer/store';
import { formatShortcut } from '@renderer/utils/stringUtils';
import { Command, Search } from 'lucide-react';

interface GlobalContentViewProps {
  title: string;
  simpleTitle?: string;
  children: ReactElement<{ searchQuery: string }>;
}

export const GlobalContentView = ({
  title,
  simpleTitle,
  children,
}: Readonly<GlobalContentViewProps>): JSX.Element => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const mode = useUIMode();
  const openCommandPalette = useStore((s) => s.openCommandPalette);
  const effectiveSearchQuery = mode === 'simple' ? '' : searchQuery;
  const effectiveTitle = mode === 'simple' ? (simpleTitle ?? title) : title;

  return (
    <div className="bg-background relative flex-1 overflow-auto">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.08),transparent)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-5xl px-8 py-12">
        {mode !== 'simple' && (
          <div className="relative mx-auto mb-8 w-full max-w-xl">
            <div
              className={`bg-card relative flex items-center gap-3 rounded-xs border px-4 py-3 transition-all duration-200 ${
                isFocused
                  ? 'border-zinc-500 shadow-[0_0_20px_rgba(255,255,255,0.04)] ring-1 ring-zinc-600/30'
                  : 'border-border hover:border-zinc-600'
              }`}
            >
              <Search className="text-muted-foreground size-4 shrink-0" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${title.toLowerCase()}...`}
                className="text-foreground placeholder:text-muted-foreground h-auto flex-1 border-0 bg-transparent px-0 py-0 text-sm shadow-none outline-hidden focus-visible:border-0 focus-visible:ring-0"
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
              />
              <Button
                variant="ghost"
                size="xs"
                onClick={() => openCommandPalette()}
                title={`Open command palette (${formatShortcut('K')})`}
                className="shrink-0 gap-1"
              >
                <kbd className="border-border bg-popover text-muted-foreground flex h-5 items-center justify-center rounded-sm border px-1.5 text-[10px] font-medium">
                  <Command className="size-2.5" />
                </kbd>
                <kbd className="border-border bg-popover text-muted-foreground flex size-5 items-center justify-center rounded-sm border text-[10px] font-medium">
                  K
                </kbd>
              </Button>
            </div>
          </div>
        )}

        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            {effectiveSearchQuery.trim() ? 'Search Results' : effectiveTitle}
          </h2>
          {effectiveSearchQuery.trim() && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setSearchQuery('')}
              className="text-muted-foreground hover:text-foreground"
            >
              Clear search
            </Button>
          )}
        </div>

        {cloneElement(children, { searchQuery: effectiveSearchQuery })}
      </div>
    </div>
  );
};
