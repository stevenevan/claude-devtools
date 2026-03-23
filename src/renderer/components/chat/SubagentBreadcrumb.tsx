/**
 * SubagentBreadcrumb - Shows navigation breadcrumb for subagent context.
 * Displays: Main Session > Task "description" > Subagent ID
 */

import { getTeamColorSet } from '@renderer/constants/teamColors';
import { cn } from '@renderer/lib/utils';
import { ChevronRight, Home } from 'lucide-react';

import type { Process } from '@shared/types/chunks';

interface SubagentBreadcrumbProps {
  subagent: Process;
  onNavigateToMain?: () => void;
  className?: string;
}

export const SubagentBreadcrumb = ({
  subagent,
  onNavigateToMain,
  className,
}: Readonly<SubagentBreadcrumbProps>): React.JSX.Element => {
  const description = subagent.description || subagent.subagentType || 'Task';
  const shortId = subagent.id.length > 12 ? `${subagent.id.slice(0, 8)}...` : subagent.id;

  return (
    <nav className={cn('flex items-center gap-1 text-xs', className)}>
      <button
        onClick={onNavigateToMain}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        title="Back to main session"
      >
        <Home className="size-3" />
        <span>Main Session</span>
      </button>

      <ChevronRight className="text-muted-foreground/50 size-3" />

      <span className="text-muted-foreground" title={subagent.description ?? undefined}>
        {description}
      </span>

      <ChevronRight className="text-muted-foreground/50 size-3" />

      <span className="text-foreground font-medium" title={subagent.id}>
        {shortId}
      </span>

      {subagent.team && (
        <>
          <span className="text-muted-foreground/50 mx-1">·</span>
          <span className="rounded-full bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-300">
            {subagent.team.memberName}
          </span>
        </>
      )}
    </nav>
  );
};
