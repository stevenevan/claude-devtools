/**
 * BashToolViewer - Specialized viewer for Bash tool calls.
 * Shows command with syntax highlighting, exit code badge, and
 * output with large-output truncation.
 */

import React from 'react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@renderer/components/ui/collapsible';
import { cn } from '@renderer/lib/utils';
import { CheckCircle, ChevronDown, ChevronRight, Terminal, XCircle } from 'lucide-react';

import type { LinkedToolItem } from '@renderer/types/groups';

interface BashToolViewerProps {
  linkedTool: LinkedToolItem;
}

const OUTPUT_PREVIEW_LINES = 30;
const LARGE_OUTPUT_THRESHOLD = 500;

/** Extract the command string from Bash tool input. */
function getCommand(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  return (input.command as string) ?? '';
}

/** Extract description from Bash tool input. */
function getDescription(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  return (input.description as string) ?? '';
}

/** Get output text from tool result. */
function getOutputText(result: LinkedToolItem['result']): string {
  if (!result?.content) return '';
  const content = result.content;
  if (typeof content === 'string') return content;
  if (typeof content === 'object') {
    return JSON.stringify(content, null, 2);
  }
  return String(content);
}

/** Detect if the output looks like an error (non-zero exit code indicator). */
function hasErrorIndicator(output: string): boolean {
  return /exit code [1-9]|Exit status: [1-9]|error:/i.test(output);
}

export const BashToolViewer: React.FC<BashToolViewerProps> = ({ linkedTool }) => {
  const [showFullOutput, setShowFullOutput] = React.useState(false);

  const command = getCommand(linkedTool.input);
  const description = getDescription(linkedTool.input);
  const output = getOutputText(linkedTool.result);
  const isError = linkedTool.result?.isError ?? false;
  const isOrphaned = linkedTool.isOrphaned;
  const outputLines = output.split('\n');
  const isLargeOutput = outputLines.length > LARGE_OUTPUT_THRESHOLD;
  const hasOutput = output.trim().length > 0;

  const previewText = isLargeOutput && !showFullOutput
    ? outputLines.slice(0, OUTPUT_PREVIEW_LINES).join('\n')
    : output;

  return (
    <div className="space-y-2">
      {/* Command section */}
      <div>
        {description && (
          <div className="text-muted-foreground mb-1 text-xs">{description}</div>
        )}
        <div className="border-border bg-muted flex items-start gap-2 rounded border p-3">
          <Terminal className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
          <code className="text-foreground flex-1 break-all whitespace-pre-wrap text-xs">
            {command}
          </code>
        </div>
      </div>

      {/* Output section */}
      {!isOrphaned && hasOutput && (
        <Collapsible defaultOpen={isError}>
          <CollapsibleTrigger className="text-muted-foreground mb-1 flex cursor-pointer items-center gap-2 border-none bg-none p-0 text-xs">
            {isError ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            Output
            {isError ? (
              <XCircle className="size-3 text-red-400" />
            ) : (
              <CheckCircle className="size-3 text-green-400/70" />
            )}
            {isLargeOutput && (
              <span className="text-muted-foreground/60 text-[10px]">
                ({outputLines.length} lines)
              </span>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div
              className={cn(
                'overflow-auto rounded border font-mono text-xs',
                isError
                  ? 'border-red-700/30 bg-red-900/10 text-red-300'
                  : 'border-border bg-muted text-muted-foreground',
                isLargeOutput && !showFullOutput ? 'max-h-none' : 'max-h-96'
              )}
            >
              <pre className="p-3 break-words whitespace-pre-wrap">{previewText}</pre>
              {isLargeOutput && !showFullOutput && (
                <div className="border-border border-t px-3 py-2">
                  <button
                    onClick={() => setShowFullOutput(true)}
                    className="text-indigo-400 hover:text-indigo-300 text-xs transition-colors"
                  >
                    Show full output ({outputLines.length - OUTPUT_PREVIEW_LINES} more lines)
                  </button>
                </div>
              )}
              {isLargeOutput && showFullOutput && (
                <div className="border-border border-t px-3 py-2">
                  <button
                    onClick={() => setShowFullOutput(false)}
                    className="text-indigo-400 hover:text-indigo-300 text-xs transition-colors"
                  >
                    Collapse output
                  </button>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Orphaned indicator */}
      {isOrphaned && (
        <div className="text-muted-foreground/50 text-xs italic">
          Awaiting result...
        </div>
      )}
    </div>
  );
};
