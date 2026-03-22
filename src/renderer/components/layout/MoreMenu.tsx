/**
 * MoreMenu - Dropdown menu behind a "..." icon for less-frequent toolbar actions.
 *
 * Groups: Search, Export (session-only), Settings.
 */

import { useCallback } from 'react';

import { Button } from '@renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { useStore } from '@renderer/store';
import { triggerDownload } from '@renderer/utils/sessionExporter';
import { formatShortcut } from '@renderer/utils/stringUtils';
import { Braces, FileText, MoreHorizontal, Search, Settings, Type } from 'lucide-react';

import type { SessionDetail } from '@renderer/types/data';
import type { Tab } from '@renderer/types/tabs';
import type { ExportFormat } from '@renderer/utils/sessionExporter';

interface MoreMenuProps {
  activeTab: Tab | undefined;
  activeTabSessionDetail: SessionDetail | null;
}

export const MoreMenu = ({
  activeTab,
  activeTabSessionDetail,
}: Readonly<MoreMenuProps>): React.JSX.Element => {
  const openCommandPalette = useStore((s) => s.openCommandPalette);
  const openSettingsTab = useStore((s) => s.openSettingsTab);

  const handleExport = useCallback(
    (format: ExportFormat) => {
      if (activeTabSessionDetail) {
        triggerDownload(activeTabSessionDetail, format);
      }
    },
    [activeTabSessionDetail]
  );

  const isSessionWithData = activeTab?.type === 'session' && activeTabSessionDetail != null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />} title="More actions">
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => openCommandPalette()}>
          <Search className="size-3.5" />
          Search
          <DropdownMenuShortcut>{formatShortcut('K')}</DropdownMenuShortcut>
        </DropdownMenuItem>

        {isSessionWithData && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleExport('markdown')}>
              <FileText className="size-3.5" />
              Export as Markdown
              <DropdownMenuShortcut>.md</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('json')}>
              <Braces className="size-3.5" />
              Export as JSON
              <DropdownMenuShortcut>.json</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('plaintext')}>
              <Type className="size-3.5" />
              Export as Plain Text
              <DropdownMenuShortcut>.txt</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => openSettingsTab()}>
          <Settings className="size-3.5" />
          Settings
          <DropdownMenuShortcut>{formatShortcut(',')}</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
