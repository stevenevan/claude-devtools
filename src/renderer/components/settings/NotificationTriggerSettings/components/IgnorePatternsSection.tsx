/**
 * IgnorePatternsSection - Collapsible section for ignore patterns - Linear style.
 */

import { cn } from '@renderer/lib/utils';
import { X } from 'lucide-react';

interface IgnorePatternsSectionProps {
  patterns: string[];
  onAdd: (pattern: string) => void;
  onRemove: (index: number) => void;
  disabled: boolean;
}

export const IgnorePatternsSection = ({
  patterns,
  onAdd,
  onRemove,
  disabled,
}: Readonly<IgnorePatternsSectionProps>): React.JSX.Element => {
  return (
    <details className="mt-4">
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs tracking-widest uppercase">
        Advanced: Exclusion Rules
      </summary>
      <div className="border-border mt-3 border-l pl-4">
        <span className="text-muted-foreground mb-2 block text-xs">
          Ignore Patterns (skip if matches)
        </span>
        {patterns.map((pattern, idx) => (
          <div key={idx} className="border-border/50 flex items-center gap-2 border-b py-1.5">
            <code className="bg-card text-muted-foreground flex-1 truncate rounded-sm px-2 py-1 font-mono text-xs">
              {pattern}
            </code>
            <button
              type="button"
              onClick={() => onRemove(idx)}
              disabled={disabled}
              className={cn(
                'text-muted-foreground rounded-sm p-1 transition-colors hover:bg-red-500/10 hover:text-red-400',
                disabled && 'cursor-not-allowed opacity-50'
              )}
              aria-label="Remove ignore pattern"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            placeholder="Add ignore regex..."
            disabled={disabled}
            className={cn(
              'border-border text-foreground placeholder:text-muted-foreground flex-1 rounded-sm border bg-transparent px-2 py-1 font-mono text-xs focus:border-transparent focus:ring-1 focus:ring-indigo-500 focus:outline-hidden',
              disabled && 'cursor-not-allowed opacity-50'
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                e.preventDefault();
                try {
                  const input = e.currentTarget;
                  const value = input.value.trim();
                  new RegExp(value);
                  onAdd(value);
                  input.value = '';
                } catch {
                  // Invalid regex
                }
              }
            }}
          />
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          Press Enter to add. Notification is skipped if any pattern matches.
        </p>
      </div>
    </details>
  );
};
