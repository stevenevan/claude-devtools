import { useStore } from '../../store';
import { parseFilterPayload } from '../../utils/filterPresetSerialization';
import { getEffectiveUIMode } from '../../utils/uiModeBootstrap';
import type { UIMode } from '@shared/types';
import type { ShortcutContext } from './shortcutContext';

const G_SEQUENCE_WINDOW_MS = 750;
let pendingGAt: number | null = null;

export function canUsePaneShortcuts(configuredMode?: UIMode): boolean {
  return getEffectiveUIMode(configuredMode) === 'nerd';
}

export function handleShortcutKeyDown(event: KeyboardEvent, ctx: ShortcutContext): void {
  const isMod = event.metaKey || event.ctrlKey;
  const state = useStore.getState();
  const isSimpleMode = !canUsePaneShortcuts(state.appConfig?.general.uiMode);

  // Ctrl+Tab / Ctrl+Shift+Tab: Switch tabs within focused pane (universal shortcut)
  if (event.ctrlKey && event.key === 'Tab') {
    event.preventDefault();
    const currentIndex = ctx.openTabs.findIndex((t) => t.id === ctx.activeTabId);

    if (event.shiftKey) {
      if (currentIndex > 0) {
        ctx.setActiveTab(ctx.openTabs[currentIndex - 1].id);
      } else if (ctx.openTabs.length > 0) {
        ctx.setActiveTab(ctx.openTabs[ctx.openTabs.length - 1].id);
      }
    } else {
      if (currentIndex !== -1 && currentIndex < ctx.openTabs.length - 1) {
        ctx.setActiveTab(ctx.openTabs[currentIndex + 1].id);
      } else if (ctx.openTabs.length > 0) {
        ctx.setActiveTab(ctx.openTabs[0].id);
      }
    }
    return;
  }

  // --- g-prefix: filter preset quick activation (g then 1..9) ---
  if (!isMod && !event.altKey && !event.shiftKey) {
    const tag = (event.target as HTMLElement)?.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (!inInput) {
      if (event.key === 'g') {
        pendingGAt = Date.now();
        return;
      }
      if (
        pendingGAt !== null &&
        Date.now() - pendingGAt <= G_SEQUENCE_WINDOW_MS &&
        /^[1-9]$/.test(event.key)
      ) {
        event.preventDefault();
        const idx = parseInt(event.key, 10) - 1;
        const state = useStore.getState();
        const presets = state.appConfig?.sessions?.filterPresets ?? [];
        const preset = presets[idx];
        pendingGAt = null;
        if (preset) {
          const filter = parseFilterPayload(preset.filter);
          if (filter !== null) state.applyFilterPreset(filter);
        }
        return;
      }
      if (pendingGAt !== null) {
        pendingGAt = null;
      }
    }
  }

  // --- ? key: shortcut cheat sheet ---
  if (!isMod && !event.altKey && event.key === '?') {
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      event.preventDefault();
      useStore.getState().toggleShortcutCheatSheet();
      return;
    }
  }

  if (!isMod && !event.altKey && !event.shiftKey) {
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      // Skip navigation shortcuts while typing in form fields
    } else if (event.key === 'j' || event.key === 'k') {
      const activeTab = ctx.getActiveTab();
      if (activeTab?.type === 'session') {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent('turn-navigate', {
            detail: { direction: event.key === 'j' ? 'next' : 'prev' },
          })
        );
        return;
      }
    } else if (event.key === 'f') {
      const activeTab = ctx.getActiveTab();
      if (activeTab?.type === 'session') {
        event.preventDefault();
        useStore.getState().toggleFlameGraph();
        return;
      }
    } else if (event.key === '[' || event.key === ']') {
      const activeTab = ctx.getActiveTab();
      if (activeTab?.type === 'session') {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent('turn-navigate', {
            detail: { direction: event.key === ']' ? 'next' : 'prev' },
          })
        );
        return;
      }
    } else if (event.key === ' ') {
      const replayMode = useStore.getState().replayMode;
      if (replayMode !== 'off') {
        event.preventDefault();
        useStore.getState().togglePlayPause();
        return;
      }
    } else if (event.key === ',' || event.key === '.') {
      const replayMode = useStore.getState().replayMode;
      if (replayMode !== 'off') {
        event.preventDefault();
        useStore.getState().stepReplay(event.key === '.' ? 'next' : 'prev');
        return;
      }
    }
  }

  if (!isMod) return;

  // Cmd+Option+1-4: Focus pane by index
  if (!isSimpleMode && event.altKey && !event.shiftKey) {
    const numKey = parseInt(event.key);
    if (numKey >= 1 && numKey <= 4) {
      event.preventDefault();
      const targetPane = ctx.paneLayout.panes[numKey - 1];
      if (targetPane) {
        ctx.focusPane(targetPane.id);
      }
      return;
    }

    // Cmd+Option+W: Close current pane
    if (event.key === 'w') {
      event.preventDefault();
      if (ctx.paneLayout.panes.length > 1) {
        ctx.closePane(ctx.paneLayout.focusedPaneId);
      }
      return;
    }
  }

  // Cmd+\: Split right with current tab
  if (event.key === '\\' && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    if (!isSimpleMode && ctx.activeTabId) {
      ctx.splitPane(ctx.paneLayout.focusedPaneId, ctx.activeTabId, 'right');
    }
    return;
  }

  // Cmd+T: New tab (Dashboard)
  if (event.key === 't') {
    event.preventDefault();
    if (isSimpleMode) ctx.setActiveActivity('projects');
    else ctx.openDashboard();
    return;
  }

  // Cmd+Shift+W: Close all tabs
  if (event.key === 'w' && event.shiftKey && !event.altKey) {
    event.preventDefault();
    ctx.closeAllTabs();
    return;
  }

  // Cmd+W: Close selected tabs (if multi-selected) or active tab
  if (event.key === 'w' && !event.altKey) {
    event.preventDefault();
    if (ctx.selectedTabIds.length > 0) {
      ctx.closeTabs(ctx.selectedTabIds);
    } else if (ctx.activeTabId) {
      ctx.closeTab(ctx.activeTabId);
    }
    return;
  }

  // Cmd+[1-9]: Switch to tab by index within focused pane
  const numKey = parseInt(event.key);
  if (numKey >= 1 && numKey <= 9 && !event.altKey) {
    event.preventDefault();
    const targetTab = ctx.openTabs[numKey - 1];
    if (targetTab) {
      ctx.setActiveTab(targetTab.id);
    }
    return;
  }

  // Cmd+Shift+]: Next tab within focused pane
  if (event.key === ']' && event.shiftKey) {
    event.preventDefault();
    const currentIndex = ctx.openTabs.findIndex((t) => t.id === ctx.activeTabId);
    if (currentIndex !== -1 && currentIndex < ctx.openTabs.length - 1) {
      ctx.setActiveTab(ctx.openTabs[currentIndex + 1].id);
    }
    return;
  }

  // Cmd+Shift+[: Previous tab within focused pane
  if (event.key === '[' && event.shiftKey) {
    event.preventDefault();
    const currentIndex = ctx.openTabs.findIndex((t) => t.id === ctx.activeTabId);
    if (currentIndex > 0) {
      ctx.setActiveTab(ctx.openTabs[currentIndex - 1].id);
    }
    return;
  }

  // Cmd+Option+Shift+Left/Right: Move active tab to a new pane (Nerd only)
  if (!isSimpleMode && event.altKey && event.shiftKey) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      if (ctx.activeTabId) {
        ctx.moveTabToNewPane(
          ctx.activeTabId,
          ctx.paneLayout.focusedPaneId,
          ctx.paneLayout.focusedPaneId,
          event.key === 'ArrowRight' ? 'right' : 'left'
        );
      }
      return;
    }
  }

  // Cmd+Option+Right: Next tab (browser-style) within focused pane
  if (event.key === 'ArrowRight' && event.altKey && !event.shiftKey) {
    event.preventDefault();
    const currentIndex = ctx.openTabs.findIndex((t) => t.id === ctx.activeTabId);
    if (currentIndex !== -1 && currentIndex < ctx.openTabs.length - 1) {
      ctx.setActiveTab(ctx.openTabs[currentIndex + 1].id);
    }
    return;
  }

  // Cmd+Option+Left: Previous tab (browser-style) within focused pane
  if (event.key === 'ArrowLeft' && event.altKey && !event.shiftKey) {
    event.preventDefault();
    const currentIndex = ctx.openTabs.findIndex((t) => t.id === ctx.activeTabId);
    if (currentIndex > 0) {
      ctx.setActiveTab(ctx.openTabs[currentIndex - 1].id);
    }
    return;
  }

  // Cmd+Shift+K: Cycle to next workspace context
  if (event.key === 'k' && event.shiftKey) {
    event.preventDefault();
    if (!ctx.isContextSwitching && ctx.availableContexts.length > 1) {
      const currentIndex = ctx.availableContexts.findIndex((c) => c.id === ctx.activeContextId);
      const nextIndex = (currentIndex + 1) % ctx.availableContexts.length;
      void ctx.switchContext(ctx.availableContexts[nextIndex].id);
    }
    return;
  }

  // Cmd+G / Cmd+Shift+G: Next / previous per-session find match
  if (event.key === 'g' && !event.altKey && ctx.searchVisible) {
    event.preventDefault();
    if (event.shiftKey) ctx.previousSearchResult();
    else ctx.nextSearchResult();
    return;
  }

  // Cmd+K: Open command palette for global search
  if (event.key === 'k') {
    event.preventDefault();
    ctx.openCommandPalette();
    return;
  }

  // Cmd+,: Open settings (standard macOS shortcut)
  if (event.key === ',') {
    event.preventDefault();
    ctx.setActiveActivity('settings');
    ctx.openSettingsTab();
    return;
  }

  // Cmd+Shift+F: Focus shell-global search
  if (event.key === 'f' && event.shiftKey) {
    event.preventDefault();
    document.getElementById('shell-search-input')?.focus();
    return;
  }

  // Cmd+F: Find in session
  if (event.key === 'f') {
    event.preventDefault();
    const activeTab = ctx.getActiveTab();
    if (activeTab?.type === 'session') {
      ctx.showSearch();
    }
    return;
  }

  // Cmd+R: Refresh current session and sidebar session list
  if (event.key === 'r') {
    event.preventDefault();
    if (ctx.selectedProjectId && ctx.selectedSessionId) {
      void Promise.all([
        ctx.refreshSessionInPlace(ctx.selectedProjectId, ctx.selectedSessionId),
        ctx.fetchSessions(ctx.selectedProjectId),
      ]).then(() => {
        window.dispatchEvent(new CustomEvent('session-refresh-scroll-bottom'));
      });
    }
    return;
  }

  // Cmd+B: Toggle sidebar
  if (event.key === 'b') {
    event.preventDefault();
    if (!isSimpleMode) ctx.toggleSidebar();
  }
}
