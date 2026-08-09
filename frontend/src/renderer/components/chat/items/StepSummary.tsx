import type { JSX } from 'react';

import { Button } from '@renderer/components/ui/button';
import { useTabUI } from '@renderer/hooks/useTabUI';
import { cn } from '@renderer/lib/utils';
import { ChevronRight, ListChecks } from 'lucide-react';

interface StepSummaryProps {
  aiGroupId: string;
  id: string;
  steps: { id: string; text: string }[];
}

export function getStepSummaryRegionId(id: string): string {
  return `${id}-details`;
}

export function isStepSummaryExpanded(expandedItemIds: ReadonlySet<string>, id: string): boolean {
  return expandedItemIds.has(id);
}

export const StepSummary = ({ id, aiGroupId, steps }: Readonly<StepSummaryProps>): JSX.Element => {
  const { getExpandedDisplayItemIds, toggleDisplayItemExpansion } = useTabUI();
  const isExpanded = isStepSummaryExpanded(getExpandedDisplayItemIds(aiGroupId), id);
  const regionId = getStepSummaryRegionId(id);
  const countLabel = `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`;

  return (
    <div className="border-border/70 bg-surface-raised/40 overflow-hidden rounded-lg border">
      <Button
        type="button"
        variant="ghost"
        aria-expanded={isExpanded}
        aria-controls={regionId}
        onClick={() => toggleDisplayItemExpansion(aiGroupId, id)}
        className="h-auto w-full justify-start gap-2 rounded-none px-3 py-2 text-left text-text-secondary"
      >
        <ChevronRight
          className={cn('size-3.5 transition-transform', isExpanded && 'rotate-90')}
          aria-hidden="true"
        />
        <ListChecks className="size-3.5" aria-hidden="true" />
        <span className="text-xs font-medium">What Claude did</span>
        <span className="text-text-muted text-xs">{countLabel}</span>
      </Button>
      <div id={regionId} role="region" aria-label="Claude's steps" hidden={!isExpanded}>
        <ul className="border-border/70 space-y-1 border-t px-3 py-2 pl-9 text-sm text-text-secondary">
          {steps.map((step) => (
            <li key={step.id}>{step.text}</li>
          ))}
        </ul>
      </div>
    </div>
  );
};
