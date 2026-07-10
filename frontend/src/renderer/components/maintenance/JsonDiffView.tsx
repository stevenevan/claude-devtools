import { JSX } from 'react';
import { DiffViewer } from '@renderer/components/chat/viewers/DiffViewer';

interface JsonDiffViewProps {
  left: string;
  right: string;
  leftLabel?: string;
  rightLabel?: string;
}

function stableKeySort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableKeySort);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = stableKeySort((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function prettyPrint(raw: string): string {
  try {
    return JSON.stringify(stableKeySort(JSON.parse(raw)), null, 2);
  } catch {
    return raw;
  }
}

// Thin wrapper around the existing DiffViewer: pretty-prints + key-sorts both
// JSON strings so the line-based diff reads as a stable structural diff,
// without writing a structural differ.
export const JsonDiffView = ({
  left,
  right,
  leftLabel,
  rightLabel,
}: Readonly<JsonDiffViewProps>): JSX.Element => {
  const prettyLeft = prettyPrint(left);
  const prettyRight = prettyPrint(right);

  return (
    <div className="flex flex-col gap-2">
      {(leftLabel || rightLabel) && (
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <span>{leftLabel ?? 'Before'}</span>
          <span>→</span>
          <span>{rightLabel ?? 'After'}</span>
        </div>
      )}
      <DiffViewer fileName="settings.json" oldString={prettyLeft} newString={prettyRight} />
    </div>
  );
};
