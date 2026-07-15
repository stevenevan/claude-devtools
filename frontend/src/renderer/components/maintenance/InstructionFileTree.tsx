import { JSX } from 'react';
import { Button } from '@renderer/components/ui/button';

import type { InstructionFile } from '@shared/types';

export type InstructionBucket = 'claude-md' | 'rtk-md' | 'rules' | 'commands' | 'tools';

export function instructionBucket(relPath: string): InstructionBucket | null {
  if (relPath === 'CLAUDE.md') return 'claude-md';
  if (relPath === 'RTK.md') return 'rtk-md';
  if (relPath.startsWith('rules/')) return 'rules';
  if (relPath.startsWith('commands/')) return 'commands';
  if (relPath.startsWith('tools/')) return 'tools';
  return null;
}

// Files under these buckets are deletable via DeleteInstructionFile;
// CLAUDE.md/RTK.md are not (server-enforced, mirrored client-side for the
// delete affordance).
export const DELETABLE_BUCKETS: ReadonlySet<InstructionBucket> = new Set([
  'rules',
  'commands',
  'tools',
]);

const BUCKET_LABELS: Record<InstructionBucket, string> = {
  'claude-md': 'CLAUDE.md',
  'rtk-md': 'RTK.md',
  rules: 'rules/',
  commands: 'commands/',
  tools: 'tools/',
};

const BUCKET_ORDER: InstructionBucket[] = ['claude-md', 'rtk-md', 'rules', 'commands', 'tools'];

interface InstructionFileTreeProps {
  files: InstructionFile[];
  selectedRelPath: string | null;
  onSelect: (relPath: string) => void;
  onCreateRulesFile: () => void;
  canAct: boolean;
}

export const InstructionFileTree = ({
  files,
  selectedRelPath,
  onSelect,
  onCreateRulesFile,
  canAct,
}: Readonly<InstructionFileTreeProps>): JSX.Element => {
  const grouped = new Map<InstructionBucket, InstructionFile[]>();
  for (const file of files) {
    const bucket = instructionBucket(file.relPath);
    if (!bucket) continue;
    const bucketFiles = grouped.get(bucket) ?? [];
    bucketFiles.push(file);
    grouped.set(bucket, bucketFiles);
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <Button variant="outline" size="sm" disabled={!canAct} onClick={onCreateRulesFile}>
        New rules file
      </Button>

      {BUCKET_ORDER.map((bucket) => {
        const bucketFiles = grouped.get(bucket) ?? [];
        if (bucketFiles.length === 0) return null;
        return (
          <div key={bucket}>
            <p className="text-muted-foreground mb-1 text-[10px] font-medium tracking-wide uppercase">
              {BUCKET_LABELS[bucket]}
            </p>
            <div className="flex flex-col gap-0.5">
              {bucketFiles.map((file) => (
                <Button
                  key={file.relPath}
                  variant={file.relPath === selectedRelPath ? 'secondary' : 'ghost'}
                  size="sm"
                  className="justify-start truncate text-xs"
                  onClick={() => onSelect(file.relPath)}
                >
                  {file.relPath}
                </Button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
