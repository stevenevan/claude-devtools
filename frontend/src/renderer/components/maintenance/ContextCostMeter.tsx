import { JSX } from 'react';
import { cn } from '@renderer/lib/utils';
import { formatBytes } from '@renderer/utils/formatters';
import { formatTokensCompact } from '@shared/utils/tokenFormatting';

import type { InstructionFile } from '@shared/types';

// Every allowlisted file here is injected into every session — these
// thresholds are display-only warnings, not enforced limits.
export const WARN_FILE_TOKENS = 8000;
export const WARN_TOTAL_TOKENS = 20000;

interface ContextCostMeterProps {
  files: InstructionFile[];
}

export const ContextCostMeter = ({ files }: Readonly<ContextCostMeterProps>): JSX.Element => {
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const totalTokens = files.reduce((sum, file) => sum + file.approxTokens, 0);
  const totalWarn = totalTokens > WARN_TOTAL_TOKENS;

  return (
    <div className="border-border/50 border-t p-3">
      <p className="text-muted-foreground mb-1 text-[10px] font-medium tracking-wide uppercase">
        Context cost
      </p>

      <div className="flex flex-col gap-0.5">
        {files.map((file) => {
          const warn = file.approxTokens > WARN_FILE_TOKENS;
          return (
            <div key={file.relPath} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground truncate" title={file.relPath}>
                {file.relPath}
              </span>
              <span
                className={cn(
                  'shrink-0',
                  warn ? 'font-medium text-amber-500' : 'text-muted-foreground'
                )}
              >
                {formatBytes(file.bytes)} · {formatTokensCompact(file.approxTokens)} tok
              </span>
            </div>
          );
        })}
      </div>

      <div
        className={cn(
          'border-border/50 mt-2 flex items-center justify-between border-t pt-2 text-xs font-medium',
          totalWarn ? 'text-amber-500' : 'text-foreground'
        )}
      >
        <span>Total</span>
        <span>
          {formatBytes(totalBytes)} · {formatTokensCompact(totalTokens)} tok
        </span>
      </div>

      {totalWarn && (
        <p className="text-muted-foreground mt-1 text-[10px]">
          Total exceeds {formatTokensCompact(WARN_TOTAL_TOKENS)} tokens — every session pays this
          cost.
        </p>
      )}
    </div>
  );
};
