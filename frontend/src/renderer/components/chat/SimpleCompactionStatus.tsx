import type { JSX } from 'react';

interface SimpleCompactionStatusProps {
  content: string;
}

export const SimpleCompactionStatus = ({
  content,
}: Readonly<SimpleCompactionStatusProps>): JSX.Element => {
  return (
    <div role="status" className="border-border bg-surface-raised/50 rounded-lg border px-4 py-2 text-center text-sm text-text-muted">
      {content}
    </div>
  );
};
