import { JSX, useMemo, useState } from 'react';
import { CopyablePath } from '@renderer/components/common/CopyablePath';
import { cn } from '@renderer/lib/utils';
import { formatBytes } from '@renderer/utils/formatters';
import { ArrowDown, ArrowUp, Link2 } from 'lucide-react';

import type { DirUsage } from '@shared/types';

interface StorageTableProps {
  dirs: DirUsage[];
}

type SortKey = 'path' | 'bytes' | 'files' | 'modTime';

interface ColumnConfig {
  key: SortKey;
  label: string;
  align?: 'right';
}

const COLUMNS: ColumnConfig[] = [
  { key: 'path', label: 'Path' },
  { key: 'bytes', label: 'Size', align: 'right' },
  { key: 'files', label: 'Files', align: 'right' },
  { key: 'modTime', label: 'Last Modified' },
];

function compareDirs(a: DirUsage, b: DirUsage, sortKey: SortKey): number {
  if (sortKey === 'path') return a.path.localeCompare(b.path);
  if (sortKey === 'modTime') return a.modTime.getTime() - b.modTime.getTime();
  return a[sortKey] - b[sortKey];
}

export const StorageTable = ({ dirs }: Readonly<StorageTableProps>): JSX.Element => {
  const [sortKey, setSortKey] = useState<SortKey>('bytes');
  const [sortDesc, setSortDesc] = useState(true);

  const sortedDirs = useMemo(() => {
    const copy = [...dirs];
    copy.sort((a, b) => (sortDesc ? -1 : 1) * compareDirs(a, b, sortKey));
    return copy;
  }, [dirs, sortKey, sortDesc]);

  const handleSort = (key: SortKey): void => {
    if (key === sortKey) {
      setSortDesc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  if (dirs.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center justify-center py-16 text-sm">
        No scan results yet.
      </div>
    );
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-border/50 text-muted-foreground border-b text-xs">
          {COLUMNS.map((col) => (
            <th
              key={col.key}
              className={cn(
                'cursor-pointer px-4 py-2 font-medium select-none',
                col.align === 'right' ? 'text-right' : 'text-left'
              )}
              onClick={() => handleSort(col.key)}
            >
              <span className="inline-flex items-center gap-1">
                {col.label}
                {sortKey === col.key &&
                  (sortDesc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sortedDirs.map((dir) => (
          <tr key={dir.path} className="border-border/50 hover:bg-card/50 border-b">
            <td className="max-w-xs px-4 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <CopyablePath
                  displayText={dir.path}
                  copyText={dir.path}
                  className="text-foreground"
                />
                {dir.isSymlink && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-[rgba(161,161,170,0.15)] px-1 py-px text-[9px] font-medium text-zinc-400">
                    <Link2 className="size-2.5" />
                    Symlink
                  </span>
                )}
              </div>
              {dir.err && <p className="text-destructive mt-0.5 text-xs">{dir.err}</p>}
            </td>
            <td className="text-muted-foreground px-4 py-2 text-right">
              {formatBytes(dir.bytes)}
            </td>
            <td className="text-muted-foreground px-4 py-2 text-right">
              {dir.files.toLocaleString()}
            </td>
            <td className="text-muted-foreground px-4 py-2">{dir.modTime.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
