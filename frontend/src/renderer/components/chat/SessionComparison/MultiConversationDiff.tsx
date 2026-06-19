import React, { useMemo } from 'react';

import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { alignColumns } from '@renderer/utils/comparisonAlignment';
import { useShallow } from 'zustand/react/shallow';

import { SessionComparisonColumn, type TurnCell } from '../SessionComparisonColumn';

import { extractTurns, turnSignature } from './turnUtils';

import type { Tab } from '@renderer/types/tabs';
import type { SessionDetail } from '@shared/types/chunks';

interface MultiConversationDiffProps {
  details: SessionDetail[];
  tab: Tab;
}

export const MultiConversationDiff = ({
  details,
  tab,
}: Readonly<MultiConversationDiffProps>): React.JSX.Element => {
  const columns = useMemo(
    () =>
      details.map((d) =>
        extractTurns(d).map(
          (t): TurnCell => ({
            userText: t.userText,
            aiSummary: t.aiSummary,
            toolCount: t.toolCount,
          })
        )
      ),
    [details]
  );

  const { rows, divergenceRowIndices } = useMemo(
    () => alignColumns(columns, turnSignature),
    [columns]
  );

  const { sessions, addCompareSession, removeCompareSession } = useStore(
    useShallow((s) => ({
      sessions: s.sessions,
      addCompareSession: s.addCompareSession,
      removeCompareSession: s.removeCompareSession,
    }))
  );

  const existingIds = new Set(details.map((d) => d.session.id));
  const pickable = sessions.filter((s) => !existingIds.has(s.id));

  return (
    <div className="border-border mt-6 rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
          Conversation · {details.length} sessions · {divergenceRowIndices.length} divergent rows
        </h2>
        {tab.projectId && pickable.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const sid = e.target.value;
              if (sid && tab.projectId) {
                addCompareSession(tab.id, tab.projectId, sid);
              }
            }}
            className="border-border bg-background text-text-secondary rounded-sm border px-2 py-1 text-[10px]"
          >
            <option value="">Add session…</option>
            {pickable.slice(0, 20).map((s) => (
              <option key={s.id} value={s.id}>
                {s.customTitle ?? s.id.slice(0, 8)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex gap-3">
        {/* Divergence rail */}
        <div className="flex w-4 flex-col gap-2 pt-6">
          {rows.map((row, idx) => (
            <div
              key={idx}
              className={cn(
                'min-h-[44px] w-1 rounded-[1px]',
                row.isDivergent ? 'bg-amber-400/70' : 'bg-border/40'
              )}
              title={row.isDivergent ? 'Divergent vs. first session' : ''}
            />
          ))}
        </div>

        {/* N columns */}
        {details.map((detail, colIdx) => {
          const title = detail.session.customTitle ?? detail.session.id.slice(0, 8);
          const cells = rows.map((r) => r.cells[colIdx] ?? null);
          const isExtra = colIdx >= 2;
          return (
            <div key={detail.session.id} className="flex min-w-0 flex-1 flex-col">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-muted-foreground truncate text-[10px]">
                  Column {colIdx + 1}
                </span>
                {isExtra && (
                  <button
                    onClick={() => removeCompareSession(tab.id, detail.session.id)}
                    className="text-muted-foreground hover:text-foreground text-[9px]"
                    title="Remove this session from comparison"
                  >
                    ×
                  </button>
                )}
              </div>
              <SessionComparisonColumn title={title} cells={cells} />
            </div>
          );
        })}
      </div>
    </div>
  );
};
