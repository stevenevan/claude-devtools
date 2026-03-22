import { isDesktopMode } from '@renderer/api';
import { getTrafficLightPaddingForZoom } from '@renderer/constants/layout';
import { useKeyboardShortcuts } from '@renderer/hooks/useKeyboardShortcuts';
import { useZoomFactor } from '@renderer/hooks/useZoomFactor';

import { UpdateBanner } from '../common/UpdateBanner';
import { UpdateDialog } from '../common/UpdateDialog';
import { WorkspaceIndicator } from '../common/WorkspaceIndicator';
import { CommandPalette } from '../search/CommandPalette';

import { ActivityBar } from './ActivityBar';
import { CustomTitleBar } from './CustomTitleBar';
import { PaneContainer } from './PaneContainer';
import { Sidebar } from './Sidebar';

export const TabbedLayout = (): React.JSX.Element => {
  useKeyboardShortcuts();
  const zoomFactor = useZoomFactor();
  const trafficLightPadding = isDesktopMode() ? getTrafficLightPaddingForZoom(zoomFactor) : 0;

  return (
    <div
      className="bg-background text-foreground flex h-screen flex-col"
      style={
        { '--macos-traffic-light-padding-left': `${trafficLightPadding}px` } as React.CSSProperties
      }
    >
      <CustomTitleBar />
      <UpdateBanner />
      <div className="flex flex-1 overflow-hidden">
        <CommandPalette />
        <ActivityBar />
        <Sidebar />
        <PaneContainer />
      </div>
      <UpdateDialog />
      <WorkspaceIndicator />
    </div>
  );
};
