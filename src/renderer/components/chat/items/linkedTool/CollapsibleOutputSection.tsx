import React from 'react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@renderer/components/ui/collapsible';
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
        className="mb-1 flex items-center gap-2 border-none bg-none p-0 text-xs"
        style={{
          color: 'var(--tool-item-muted)',
          cursor: 'pointer',
        }}
      >
        {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {label}
        <StatusDot status={status} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          className="max-h-96 overflow-auto rounded p-3 font-mono text-xs"
          style={{
            backgroundColor: 'var(--code-bg)',
            border: '1px solid var(--code-border)',
            color:
              status === 'error' ? 'var(--tool-result-error-text)' : 'var(--color-text-secondary)',
          }}
        >
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
