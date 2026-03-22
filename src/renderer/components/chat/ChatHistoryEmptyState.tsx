/**
 * Empty state for ChatHistory when no conversation exists.
 */

import { MessageSquare } from 'lucide-react';

export const ChatHistoryEmptyState = (): JSX.Element => {
  return (
    <div className="bg-surface flex flex-1 items-center justify-center overflow-hidden">
      <div className="text-text-muted space-y-2 text-center">
        <MessageSquare className="mx-auto mb-4 size-12 opacity-30" />
        <div className="text-text-secondary text-xl font-medium">No conversation history</div>
        <div className="text-sm">This session does not contain any messages yet.</div>
      </div>
    </div>
  );
};
