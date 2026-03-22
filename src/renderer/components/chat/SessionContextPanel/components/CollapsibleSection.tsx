import React from 'react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@renderer/components/ui/collapsible';
import { cn } from '@renderer/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { formatTokens } from '../utils/formatting';

interface CollapsibleSectionProps {
  title: string;
  count: number;
  tokenCount: number;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export const CollapsibleSection = ({
  title,
  count,
  tokenCount,
  isExpanded,
  onToggle,
  children,
}: Readonly<CollapsibleSectionProps>): React.ReactElement => {
  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <div
        className="overflow-hidden rounded-lg border border-border-subtle bg-surface-raised"
      >
        <CollapsibleTrigger
          className={cn(
            'flex w-full items-center justify-between px-3 py-2 transition-colors',
            isExpanded ? 'bg-surface-overlay' : 'bg-transparent'
          )}
        >
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown size={14} className="text-text-secondary" />
            ) : (
              <ChevronRight size={14} className="text-text-secondary" />
            )}
            <span className="text-sm font-medium text-text">
              {title}
            </span>
            <span
              className="rounded-sm bg-surface-overlay px-1.5 py-0.5 text-xs text-text-secondary"
            >
              {count}
            </span>
          </div>
          <span className="text-xs text-text-muted">
            ~{formatTokens(tokenCount)} tokens
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div
            className="space-y-2 border-t border-border-subtle px-3 py-2"
          >
            {children}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};
