/**
 * CustomTitleBar - Conventional title bar for Windows and Linux when the native frame is hidden.
 *
 * Renders a draggable top strip with window controls (minimize, maximize/restore, close)
 * on the right. Only shown in Electron on Windows or Linux (macOS uses native traffic lights).
 */

import { useEffect, useState } from 'react';

import { api, isDesktopMode } from '@renderer/api';
import faviconUrl from '@renderer/favicon.png';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { Minus, Square, X } from 'lucide-react';

const TITLE_BAR_HEIGHT = 32;

function needsCustomTitleBar(): boolean {
  if (!isDesktopMode()) return false;
  const ua = window.navigator.userAgent;
  return ua.includes('Windows') || ua.includes('Linux');
}

export const CustomTitleBar = (): React.JSX.Element | null => {
  const [isMaximized, setIsMaximized] = useState(false);
  const useNativeTitleBar = useStore((s) => s.appConfig?.general?.useNativeTitleBar ?? false);
  const showTitleBar = needsCustomTitleBar() && !useNativeTitleBar;
  const windowApi = typeof window !== 'undefined' ? api.windowControls : null;

  useEffect(() => {
    if (windowApi) void windowApi.isMaximized().then(setIsMaximized);
  }, [windowApi]);

  if (!showTitleBar || !windowApi) return null;

  const { minimize, maximize, close, isMaximized: getIsMaximized } = windowApi;

  const handleMaximize = async (): Promise<void> => {
    await maximize();
    const maximized = await getIsMaximized();
    setIsMaximized(maximized);
  };

  const buttonBase = cn(
    'flex h-full w-12 items-center justify-center transition-colors border-0 outline-hidden text-text-secondary'
  );

  return (
    <div
      className="flex shrink-0 items-stretch select-none bg-surface-sidebar border-b border-border"
      style={
        {
          height: `${TITLE_BAR_HEIGHT}px`,
          WebkitAppRegion: 'drag',
        } as React.CSSProperties
      }
    >
      {/* Draggable area — app icon */}
      <div className="flex flex-1 min-w-0 items-center pl-3">
        <img src={faviconUrl} alt="" className="size-5 shrink-0 rounded-sm" draggable={false} />
      </div>

      {/* Window controls — no-drag so they receive clicks */}
      <div className="flex shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          type="button"
          className={cn(buttonBase, 'hover:bg-white/10')}
          onClick={() => void minimize()}
          title="Minimize"
          aria-label="Minimize"
        >
          <Minus className="size-4" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          className={cn(buttonBase, 'hover:bg-white/10')}
          onClick={() => void handleMaximize()}
          title={isMaximized ? 'Restore' : 'Maximize'}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          <Square className="size-3.5" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          className={cn(buttonBase, 'hover:bg-red-500/90 hover:text-white')}
          onClick={() => void close()}
          title="Close"
          aria-label="Close"
        >
          <X className="size-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
};
