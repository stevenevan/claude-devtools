/**
 * FileQuickPeek - Hover tooltip preview of a file path.
 * Shows the file path with a copy-to-clipboard action.
 */

import { cn } from '@renderer/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip';
import { FileText } from 'lucide-react';

interface FileQuickPeekProps {
  filePath: string;
  children: React.ReactNode;
  className?: string;
}

export const FileQuickPeek = ({
  filePath,
  children,
  className,
}: Readonly<FileQuickPeekProps>): React.JSX.Element => {
  const fileName = filePath.split('/').pop() ?? filePath;
  const dirPath = filePath.slice(0, filePath.length - fileName.length);

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn('cursor-pointer', className)}
        onClick={() => void navigator.clipboard.writeText(filePath)}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <div className="flex items-center gap-1.5">
          <FileText className="size-3 shrink-0 text-blue-400" />
          <span className="truncate font-mono text-xs">
            <span className="text-muted-foreground">{dirPath}</span>
            <span className="text-foreground font-medium">{fileName}</span>
          </span>
        </div>
        <p className="text-muted-foreground mt-1 text-[10px]">Click to copy path</p>
      </TooltipContent>
    </Tooltip>
  );
};
