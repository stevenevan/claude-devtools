/**
 * ExportDropdown - Download icon button with dropdown for exporting session data.
 *
 * Supports three formats: Markdown (.md), JSON (.json), Plain Text (.txt).
 */

import { useCallback } from 'react';

import { Button } from '@renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { triggerDownload } from '@renderer/utils/sessionExporter';
import { Braces, Download, FileText, Type } from 'lucide-react';

import type { SessionDetail } from '@renderer/types/data';
import type { ExportFormat } from '@renderer/utils/sessionExporter';

interface ExportDropdownProps {
  sessionDetail: SessionDetail;
}

interface FormatOption {
  format: ExportFormat;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  ext: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  { format: 'markdown', label: 'Markdown', icon: FileText, ext: '.md' },
  { format: 'json', label: 'JSON', icon: Braces, ext: '.json' },
  { format: 'plaintext', label: 'Plain Text', icon: Type, ext: '.txt' },
];

export const ExportDropdown = ({
  sessionDetail,
}: Readonly<ExportDropdownProps>): React.JSX.Element => {
  const handleExport = useCallback(
    (format: ExportFormat) => {
      triggerDownload(sessionDetail, format);
    },
    [sessionDetail]
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />} title="Export session">
        <Download className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Export Session</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {FORMAT_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.format} onClick={() => handleExport(option.format)}>
            <option.icon className="size-3.5" />
            {option.label}
            <DropdownMenuShortcut>{option.ext}</DropdownMenuShortcut>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
