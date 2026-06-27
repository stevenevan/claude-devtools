import { JSX } from 'react';
import type { ParsedNLQuery } from '@shared/types/api';

interface Props {
  parsed: ParsedNLQuery | null;
}

function formatDateChip(ms: number): string {
  return `since ${new Date(ms).toLocaleDateString()}`;
}

export const ParsedFilterChips = ({ parsed }: Readonly<Props>): JSX.Element | null => {
  if (!parsed) return null;

  const chips: { label: string; value: string }[] = [];
  if (parsed.dateMin !== undefined)
    chips.push({ label: 'date', value: formatDateChip(parsed.dateMin) });
  if (parsed.agentName) chips.push({ label: 'tool', value: parsed.agentName });
  if (parsed.minCost !== undefined) chips.push({ label: 'cost', value: `≥ $${parsed.minCost}` });
  if (parsed.hasErrors) chips.push({ label: 'errors', value: 'yes' });
  if (parsed.textQuery) chips.push({ label: 'text', value: `"${parsed.textQuery}"` });
  if (parsed.author) chips.push({ label: 'author', value: parsed.author });

  if (chips.length === 0) {
    return (
      <p className="text-text-muted text-[11px] italic">
        Nothing matched — try phrases like “last 7 days using Bash with errors”.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((chip, idx) => (
        <span
          key={idx}
          className="border-border bg-surface-raised text-text-secondary inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]"
        >
          <span className="text-text-muted tracking-wider uppercase">{chip.label}</span>
          <span>{chip.value}</span>
        </span>
      ))}
    </div>
  );
};
