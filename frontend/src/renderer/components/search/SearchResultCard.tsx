import { JSX, ReactNode, Ref } from 'react';

import { useUIMode } from '@renderer/hooks/useUIMode';
import { formatConversationTime } from '@renderer/components/dashboard/dashboardFormatters';
import { cn } from '@renderer/lib/utils';

export function SearchSnippetText({
  text,
  query,
}: Readonly<{ text: string; query: string }>): JSX.Element {
  const needle = query.trim().toLowerCase();
  if (!needle) return <span>{text}</span>;

  const segments: ReactNode[] = [];
  const lowerText = text.toLowerCase();
  let lastIndex = 0;
  let position = lowerText.indexOf(needle);
  let key = 0;
  while (position !== -1) {
    if (position > lastIndex) {
      segments.push(<span key={key++}>{text.slice(lastIndex, position)}</span>);
    }
    segments.push(
      <mark key={key++} className="rounded bg-yellow-500/30 px-0.5 text-inherit">
        {text.slice(position, position + needle.length)}
      </mark>
    );
    lastIndex = position + needle.length;
    position = lowerText.indexOf(needle, lastIndex);
  }
  if (lastIndex < text.length) {
    segments.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }
  return <>{segments}</>;
}

export interface SearchResultCardProps {
  title: string;
  snippet: string;
  query: string;
  timestamp: number;
  path?: string;
  projectLabel?: string;
  badges?: ReactNode;
  selected?: boolean;
  role?: 'option';
  ref?: Ref<HTMLButtonElement>;
  onFocus?: () => void;
  onOpen?: () => void;
}

export const SearchResultCard = ({
  title,
  snippet,
  query,
  timestamp,
  path,
  projectLabel,
  badges,
  selected,
  role,
  ref,
  onFocus,
  onOpen,
}: Readonly<SearchResultCardProps>): JSX.Element => {
  const mode = useUIMode();
  const simple = mode === 'simple';

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {projectLabel && !simple ? (
            <p className="text-muted-foreground truncate text-xs font-medium">{projectLabel}</p>
          ) : null}
          <p className="text-foreground truncate text-sm font-medium">{title}</p>
          {snippet ? (
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-relaxed">
              <SearchSnippetText text={snippet} query={query} />
            </p>
          ) : null}
        </div>
        {badges ? <div className="flex shrink-0 items-center gap-1.5">{badges}</div> : null}
      </div>
      <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
        {simple ? (
          <time dateTime={new Date(timestamp).toISOString()}>
            {formatConversationTime(timestamp)}
          </time>
        ) : (
          <>
            <time dateTime={new Date(timestamp).toISOString()}>
              {new Date(timestamp).toLocaleString()}
            </time>
            {path ? <span className="truncate font-mono">{path}</span> : null}
          </>
        )}
      </div>
    </>
  );

  if (!onOpen) {
    return (
      <div className="w-full p-4 text-left" role={role} aria-selected={selected}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      ref={ref}
      onClick={onOpen}
      onFocus={onFocus}
      role={role}
      aria-selected={selected}
      aria-label={`${title}, ${formatConversationTime(timestamp)}`}
      className={cn(
        'border-border hover:bg-card block w-full rounded-md border p-4 text-left transition-colors',
        selected && 'border-indigo-500/50 bg-indigo-500/5'
      )}
    >
      {body}
    </button>
  );
};
