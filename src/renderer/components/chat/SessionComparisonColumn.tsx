import { cn } from '@renderer/lib/utils';

interface TurnCell {
  userText: string;
  aiSummary: string;
  toolCount: number;
}

interface SessionComparisonColumnProps {
  title: string;
  cells: (TurnCell | null)[];
  className?: string;
}

export const SessionComparisonColumn = ({
  title,
  cells,
  className,
}: Readonly<SessionComparisonColumnProps>): React.JSX.Element => (
  <div className={cn('flex min-w-0 flex-1 flex-col gap-2', className)}>
    <div className="text-foreground truncate text-[11px] font-medium">{title}</div>
    <div className="flex flex-col gap-2">
      {cells.map((cell, idx) => (
        <div
          key={idx}
          className={cn(
            'min-h-[44px] rounded-sm border px-2 py-1.5 text-[10px]',
            cell ? 'border-border bg-background/60' : 'border-amber-500/30 bg-amber-500/5'
          )}
        >
          {cell ? (
            <>
              <div className="text-foreground mb-0.5 line-clamp-2 text-[10px] leading-snug">
                {cell.userText}
              </div>
              <div className="text-muted-foreground line-clamp-1 text-[9px]">
                {cell.toolCount > 0 && `${cell.toolCount} tools · `}
                {cell.aiSummary || 'No response'}
              </div>
            </>
          ) : (
            <span className="text-muted-foreground/60 italic">—</span>
          )}
        </div>
      ))}
    </div>
  </div>
);

export type { TurnCell };
