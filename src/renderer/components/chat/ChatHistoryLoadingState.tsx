/**
 * Loading skeleton for ChatHistory while conversation is loading.
 * Industrial shimmer with organic line widths — no generic pulse.
 */
import { Skeleton } from '@renderer/components/ui/skeleton';

export const ChatHistoryLoadingState = (): JSX.Element => {
  const rows = [
    { user: ['85%', '60%'], ai: ['92%', '70%', '82%', '45%'] },
    { user: ['75%', '92%', '40%'], ai: ['88%', '65%', '78%'] },
    { user: ['95%', '55%'], ai: ['72%', '85%', '60%', '92%', '35%'] },
  ];

  return (
    <div className="bg-background flex flex-1 items-center justify-center overflow-hidden">
      <div className="w-full max-w-5xl space-y-8 px-6">
        {rows.map((row, i) => (
          <div key={i} className="space-y-6">
            {/* User message skeleton — right aligned */}
            <div className="flex justify-end">
              <div className="w-2/3 space-y-2">
                {row.user.map((width, j) => (
                  <Skeleton key={j} className="ml-auto h-3 rounded-xs" style={{ width }} />
                ))}
              </div>
            </div>
            {/* AI response skeleton — left aligned with border accent */}
            <div className="border-border space-y-2.5 border-l-2 pl-3">
              {row.ai.map((width, j) => (
                <Skeleton key={j} className="h-3 rounded-xs" style={{ width }} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
