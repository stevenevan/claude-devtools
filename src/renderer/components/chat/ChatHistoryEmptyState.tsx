/**
 * Empty state for ChatHistory when no conversation exists.
 */
export const ChatHistoryEmptyState = (): JSX.Element => {
  return (
    <div className="bg-surface flex flex-1 items-center justify-center overflow-hidden">
      <div className="text-text-muted space-y-2 text-center">
        <div className="mb-4 text-6xl">💬</div>
        <div className="text-text-secondary text-xl font-medium">No conversation history</div>
        <div className="text-sm">This session does not contain any messages yet.</div>
      </div>
    </div>
  );
};
