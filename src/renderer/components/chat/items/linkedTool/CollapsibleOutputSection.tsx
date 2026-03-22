import React from 'react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@renderer/components/ui/collapsible';
import { cn } from '@renderer/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { type ItemStatus, StatusDot } from '../BaseItem';

interface CollapsibleOutputSectionProps {
  status: ItemStatus;
  children: React.ReactNode;
  label?: string;
}

export const CollapsibleOutputSection: React.FC<CollapsibleOutputSectionProps> = ({
  status,
  children,
  label = 'Output',
}) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <CollapsibleTrigger
        className="mb-1 flex cursor-pointer items-center gap-2 border-none bg-none p-0 text-xs text-[var(--tool-item-muted)]"
      >
        {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {label}
        <StatusDot status={status} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          className={cn(
            'max-h-96 overflow-auto rounded border border-[var(--code-border)] bg-[var(--code-bg)] p-3 font-mono text-xs',
            status === 'error' ? 'text-[var(--tool-result-error-text)]' : 'text-text-secondary'
          )}
        >
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
