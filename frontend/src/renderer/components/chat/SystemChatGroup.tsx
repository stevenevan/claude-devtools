import { JSX, memo } from 'react';
import { format } from 'date-fns';
import { Terminal } from 'lucide-react';

import type { SystemGroup } from '@renderer/types/groups';

// Module-level constant - safe because .replace() resets lastIndex on g-flagged regexes
const ANSI_ESCAPE_REGEX = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

interface SystemChatGroupProps {
  systemGroup: SystemGroup;
}

const SystemChatGroupInner = ({
  systemGroup,
}: Readonly<SystemChatGroupProps>): JSX.Element => {
  const { commandOutput, timestamp } = systemGroup;

  const cleanOutput = commandOutput.replace(ANSI_ESCAPE_REGEX, '');

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <Terminal className="text-muted-foreground size-3.5" />
          <span className="text-muted-foreground font-medium">System</span>
          <span>·</span>
          <span>{format(timestamp, 'h:mm:ss a')}</span>
        </div>

        <div className="bg-card/50 rounded-lg px-4 py-3">
          <pre className="text-muted-foreground font-mono text-sm whitespace-pre-wrap">
            {cleanOutput}
          </pre>
        </div>
      </div>
    </div>
  );
};

// ponytail: memo kept — virtualized row
export const SystemChatGroup = memo(SystemChatGroupInner);
