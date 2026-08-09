import type { JSX } from 'react';

import { Button } from '@renderer/components/ui/button';
import {
  formatApproximateConversationCost,
  formatConversationMessageCount,
  formatConversationSubject,
  formatConversationTime,
} from '@renderer/components/dashboard/dashboardFormatters';
import { ArrowLeft } from 'lucide-react';

import type { Session } from '@shared/types';

interface SimpleSessionHeaderProps {
  session: Session;
  onBack: () => void;
}

export const SimpleSessionHeader = ({
  session,
  onBack,
}: Readonly<SimpleSessionHeaderProps>): JSX.Element => {
  const subject = formatConversationSubject(session);
  const relativeTime = formatConversationTime(session.createdAt);
  const messageCount = formatConversationMessageCount(session.messageCount);
  const cost = formatApproximateConversationCost(session.costUsd);

  return (
    <header className="border-border/60 bg-background shrink-0 border-b px-6 py-4">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onBack}
        aria-label="Back to conversations"
        className="-ml-2 mb-2 text-text-secondary"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Conversations
      </Button>
      <h1 className="text-foreground truncate text-lg font-semibold tracking-tight" title={subject}>
        {subject}
      </h1>
      <div className="text-text-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <time dateTime={new Date(session.createdAt).toISOString()}>{relativeTime}</time>
        <span aria-hidden="true">·</span>
        <span>{messageCount}</span>
        <span aria-hidden="true">·</span>
        <span>{cost}</span>
      </div>
    </header>
  );
};
