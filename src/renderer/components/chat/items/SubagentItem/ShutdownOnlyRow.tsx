import { type getTeamColorSet } from '@renderer/constants/teamColors';
import { formatDuration } from '@renderer/utils/formatters';

import type { Process } from '@renderer/types/data';

interface ShutdownOnlyRowProps {
  team: NonNullable<Process['team']>;
  teamColors: ReturnType<typeof getTeamColorSet>;
  durationMs: Process['durationMs'];
}

export const ShutdownOnlyRow = ({
  team,
  teamColors,
  durationMs,
}: ShutdownOnlyRowProps): JSX.Element => {
  return (
    <div className="border-border bg-card flex items-center gap-2 rounded-md border px-3 py-1.5 opacity-60">
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: teamColors.border }}
      />
      <span
        className="rounded-sm px-1.5 py-0.5 text-[10px] font-medium tracking-wide"
        style={{
          backgroundColor: teamColors.badge,
          color: teamColors.text,
          border: `1px solid ${teamColors.border}40`,
        }}
      >
        {team.memberName}
      </span>
      <span className="text-muted-foreground text-xs">Shutdown confirmed</span>
      <span className="flex-1" />
      <span className="text-muted-foreground shrink-0 font-mono text-[11px] tabular-nums">
        {formatDuration(durationMs)}
      </span>
    </div>
  );
};
