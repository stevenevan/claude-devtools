import { JSX, useCallback, useMemo, useRef, useState } from 'react';
import { cn } from '@renderer/lib/utils';
import { ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';

import { Button } from '../../ui/button';

import { extractTurns, isDivergent } from './turnUtils';

import type { SessionDetail } from '@shared/types/chunks';

interface ConversationDiffProps {
  leftDetail: SessionDetail;
  rightDetail: SessionDetail;
}

export const ConversationDiff = ({
  leftDetail,
  rightDetail,
}: Readonly<ConversationDiffProps>): JSX.Element | null => {
  const leftTurns = useMemo(() => extractTurns(leftDetail), [leftDetail]);
  const rightTurns = useMemo(() => extractTurns(rightDetail), [rightDetail]);

  const maxTurns = Math.max(leftTurns.length, rightTurns.length);

  // Find divergent turn indices
  const divergentIndices = useMemo(() => {
    const indices: number[] = [];
    for (let i = 0; i < maxTurns; i++) {
      const left = leftTurns[i];
      const right = rightTurns[i];
      if (!left || !right || isDivergent(left.userText, right.userText)) {
        indices.push(i);
      }
    }
    return indices;
  }, [leftTurns, rightTurns, maxTurns]);

  const [currentDivergenceIdx, setCurrentDivergenceIdx] = useState(0);
  const turnRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const scrollToDivergence = useCallback(
    (idx: number) => {
      const turnIndex = divergentIndices[idx];
      if (turnIndex == null) return;
      const el = turnRefs.current.get(turnIndex);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setCurrentDivergenceIdx(idx);
    },
    [divergentIndices]
  );

  if (maxTurns === 0) return null;

  return (
    <div className="border-border mt-6 rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
          Conversation ({maxTurns} turns)
        </h2>
        {divergentIndices.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground text-[10px]">
              {divergentIndices.length} divergence{divergentIndices.length !== 1 && 's'}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() =>
                scrollToDivergence(
                  (currentDivergenceIdx - 1 + divergentIndices.length) % divergentIndices.length
                )
              }
              title="Previous divergence"
            >
              <ChevronUp className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() =>
                scrollToDivergence((currentDivergenceIdx + 1) % divergentIndices.length)
              }
              title="Next divergence"
            >
              <ChevronDown className="size-3" />
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {Array.from({ length: maxTurns }).map((_, i) => {
          const left = leftTurns[i];
          const right = rightTurns[i];
          const hasDivergence =
            !left || !right || isDivergent(left?.userText ?? '', right?.userText ?? '');

          return (
            <div
              key={i}
              ref={(el) => {
                if (el) turnRefs.current.set(i, el);
              }}
              className={cn(
                'flex gap-3 rounded-sm border px-3 py-2',
                hasDivergence ? 'border-amber-500/30 bg-amber-500/5' : 'border-border'
              )}
            >
              {/* Turn number */}
              <div className="text-muted-foreground flex shrink-0 items-start pt-0.5 text-[10px] tabular-nums">
                <MessageSquare className="mr-1 size-3" />
                {i + 1}
              </div>

              {/* Left session */}
              <div className="min-w-0 flex-1">
                {left ? (
                  <>
                    <div className="text-foreground mb-0.5 text-[11px] leading-snug">
                      {left.userText}
                    </div>
                    <div className="text-muted-foreground text-[10px]">
                      {left.toolCount > 0 && `${left.toolCount} tools · `}
                      {left.aiSummary
                        ? left.aiSummary.slice(0, 80) + (left.aiSummary.length > 80 ? '...' : '')
                        : 'No response'}
                    </div>
                  </>
                ) : (
                  <span className="text-muted-foreground/50 text-[10px] italic">—</span>
                )}
              </div>

              {/* Divider */}
              <div className="border-border w-px self-stretch border-l" />

              {/* Right session */}
              <div className="min-w-0 flex-1">
                {right ? (
                  <>
                    <div className="text-foreground mb-0.5 text-[11px] leading-snug">
                      {right.userText}
                    </div>
                    <div className="text-muted-foreground text-[10px]">
                      {right.toolCount > 0 && `${right.toolCount} tools · `}
                      {right.aiSummary
                        ? right.aiSummary.slice(0, 80) + (right.aiSummary.length > 80 ? '...' : '')
                        : 'No response'}
                    </div>
                  </>
                ) : (
                  <span className="text-muted-foreground/50 text-[10px] italic">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
