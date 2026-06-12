import type { JSX } from 'react';
interface SessionTitleHeaderProps {
  customTitle?: string;
  agentName?: string;
}

export const SessionTitleHeader = ({
  customTitle,
  agentName,
}: SessionTitleHeaderProps): JSX.Element | null => {
  if (!customTitle && !agentName) return null;

  return (
    <div className="mb-6">
      {customTitle && <h1 className="text-foreground text-lg font-semibold">{customTitle}</h1>}
      {agentName && agentName !== customTitle && (
        <p className="text-muted-foreground mt-1 text-sm">Agent: {agentName}</p>
      )}
    </div>
  );
};
