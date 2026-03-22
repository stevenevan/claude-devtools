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
      <div className="border-border-subtle bg-surface-raised overflow-hidden rounded-lg border">
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
            <span className="text-text text-sm font-medium">{title}</span>
            <span className="bg-surface-overlay text-text-secondary rounded-sm px-1.5 py-0.5 text-xs">
              {count}
            </span>
          </div>
          <span className="text-text-muted text-xs">~{formatTokens(tokenCount)} tokens</span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-border-subtle space-y-2 border-t px-3 py-2">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};
