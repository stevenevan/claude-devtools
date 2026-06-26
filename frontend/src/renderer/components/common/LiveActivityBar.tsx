import { cn } from '@renderer/lib/utils';
import { Brain, Code, FileText, Loader2, Pencil, Search, Terminal } from 'lucide-react';

import type { SemanticStep } from '@shared/types/chunks';

interface LiveActivityBarProps {
  lastStep?: SemanticStep | null;
  className?: string;
}

function getInputPreview(step: SemanticStep): string {
  const input = step.content.toolInput;
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  const path = obj.file_path ?? obj.path ?? obj.pattern ?? obj.command;
  return typeof path === 'string' ? path : '';
}

function getActivityFromStep(step: SemanticStep | null | undefined): {
  icon: React.ElementType;
  label: string;
} {
  if (!step) {
    return { icon: Loader2, label: 'Working...' };
  }

  if (step.type === 'thinking') {
    return { icon: Brain, label: 'Thinking...' };
  }

  if (step.type === 'tool_call') {
    const toolName = step.content.toolName ?? '';
    const input = getInputPreview(step);

    switch (toolName) {
      case 'Bash':
        return { icon: Terminal, label: 'Running command...' };
      case 'Read':
        return {
          icon: FileText,
          label: input ? `Reading ${truncatePath(input)}` : 'Reading file...',
        };
      case 'Write':
        return {
          icon: FileText,
          label: input ? `Writing ${truncatePath(input)}` : 'Writing file...',
        };
      case 'Edit':
        return {
          icon: Pencil,
          label: input ? `Editing ${truncatePath(input)}` : 'Editing file...',
        };
      case 'Grep':
      case 'Glob':
        return { icon: Search, label: 'Searching codebase...' };
      case 'Agent':
        return { icon: Code, label: 'Spawning subagent...' };
      case 'Skill':
        return { icon: Code, label: 'Running skill...' };
      default:
        return { icon: Code, label: toolName ? `Running ${toolName}...` : 'Running tool...' };
    }
  }

  if (step.type === 'output') {
    return { icon: Loader2, label: 'Generating response...' };
  }

  return { icon: Loader2, label: 'Working...' };
}

function truncatePath(pathOrInput: string): string {
  const pathMatch = /\/[\w/.-]+/.exec(pathOrInput);
  if (pathMatch) {
    const segments = pathMatch[0].split('/').filter(Boolean);
    if (segments.length > 2) {
      return `.../${segments.slice(-2).join('/')}`;
    }
    return pathMatch[0];
  }
  return pathOrInput.length > 40 ? `${pathOrInput.slice(0, 40)}...` : pathOrInput;
}

export const LiveActivityBar = ({
  lastStep,
  className,
}: Readonly<LiveActivityBarProps>): React.JSX.Element => {
  const { icon: Icon, label } = getActivityFromStep(lastStep);
  const isSpinner = Icon === Loader2;

  return (
    <div
      className={cn(
        'flex w-full items-center justify-center gap-2.5 rounded-lg border px-4 py-3',
        'border-green-500/30 bg-green-500/5',
        className
      )}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      </span>
      <Icon className={cn('size-4 shrink-0 text-green-400', isSpinner && 'animate-spin')} />
      <span className="text-sm text-green-300/90 tabular-nums">{label}</span>
    </div>
  );
};
