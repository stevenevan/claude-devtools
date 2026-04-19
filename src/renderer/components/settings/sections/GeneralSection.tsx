/**
 * GeneralSection - General settings including startup, appearance, browser access, and local Claude root.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, isDesktopMode } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { Alert, AlertDescription } from '@renderer/components/ui/alert';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';
import { useClipboard } from '@renderer/hooks/mantine';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { getFullResetState } from '@renderer/store/utils/stateResetHelpers';
import { Check, Copy, FolderOpen, Laptop, Loader2, RotateCcw } from 'lucide-react';

import { SettingRow, SettingsSectionHeader } from '../components';

import type { SafeConfig } from '../hooks/useSettingsConfig';
import type { ClaudeRootInfo, WslClaudeRootCandidate } from '@shared/types';
import type { HttpServerStatus } from '@shared/types/api';
import type { AppConfig } from '@shared/types/notifications';

// Theme options
const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
] as const;

const CODE_BLOCK_THEME_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'github-dark', label: 'GitHub Dark' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'monokai', label: 'Monokai' },
] as const;

interface GeneralSectionProps {
  readonly safeConfig: SafeConfig;
  readonly saving: boolean;
  readonly onGeneralToggle: (key: keyof AppConfig['general'], value: boolean) => void;
  readonly onThemeChange: (value: 'dark' | 'light' | 'system') => void;
  readonly onDisplayToggle: (key: keyof AppConfig['display'], value: boolean) => void;
  readonly onCodeBlockThemeChange: (value: string) => void;
}

export const GeneralSection = ({
  safeConfig,
  saving,
  onGeneralToggle,
  onThemeChange,
  onDisplayToggle,
  onCodeBlockThemeChange,
}: GeneralSectionProps): React.JSX.Element => {
  const [serverStatus, setServerStatus] = useState<HttpServerStatus>({
    running: false,
    port: 3456,
  });
  const [serverLoading, setServerLoading] = useState(false);
  const { copy, copied } = useClipboard({ timeout: 2000 });

  // Claude Root state
  const connectionMode = useStore((s) => s.connectionMode);
  const fetchProjects = useStore((s) => s.fetchProjects);
  const fetchRepositoryGroups = useStore((s) => s.fetchRepositoryGroups);

  const [claudeRootInfo, setClaudeRootInfo] = useState<ClaudeRootInfo | null>(null);
  const [updatingClaudeRoot, setUpdatingClaudeRoot] = useState(false);
  const [claudeRootError, setClaudeRootError] = useState<string | null>(null);
  const [findingWslRoots, setFindingWslRoots] = useState(false);
  const [wslCandidates, setWslCandidates] = useState<WslClaudeRootCandidate[]>([]);
  const [showWslModal, setShowWslModal] = useState(false);

  // Fetch server status and Claude root info on mount
  useEffect(() => {
    void api.httpServer.getStatus().then(setServerStatus);
  }, []);

  const loadClaudeRootInfo = useCallback(async () => {
    try {
      const info = await api.config.getClaudeRootInfo();
      setClaudeRootInfo(info);
    } catch (error) {
      setClaudeRootError(
        error instanceof Error ? error.message : 'Failed to load local Claude root settings'
      );
    }
  }, []);

  useEffect(() => {
    void loadClaudeRootInfo();
  }, [loadClaudeRootInfo]);

  const handleServerToggle = useCallback(async (enabled: boolean) => {
    setServerLoading(true);
    try {
      const status = enabled ? await api.httpServer.start() : await api.httpServer.stop();
      setServerStatus(status);
    } catch {
      // Status didn't change
    } finally {
      setServerLoading(false);
    }
  }, []);

  const serverUrl = `http://localhost:${serverStatus.port}`;

  const handleCopyUrl = useCallback(() => copy(serverUrl), [copy, serverUrl]);

  // Claude Root handlers
  const resetWorkspaceForRootChange = useCallback((): void => {
    useStore.setState({
      projects: [],
      repositoryGroups: [],
      openTabs: [],
      activeTabId: null,
      selectedTabIds: [],
      paneLayout: {
        panes: [
          {
            id: 'pane-default',
            tabs: [],
            activeTabId: null,
            selectedTabIds: [],
            widthFraction: 1,
          },
        ],
        focusedPaneId: 'pane-default',
      },
      ...getFullResetState(),
    });
  }, []);

  const applyClaudeRootPath = useCallback(
    async (claudeRootPath: string | null): Promise<void> => {
      try {
        setUpdatingClaudeRoot(true);
        setClaudeRootError(null);

        await api.config.update('general', { claudeRootPath });
        await loadClaudeRootInfo();

        if (connectionMode === 'local') {
          resetWorkspaceForRootChange();
          await Promise.all([fetchProjects(), fetchRepositoryGroups()]);
        }
      } catch (error) {
        setClaudeRootError(error instanceof Error ? error.message : 'Failed to update Claude root');
      } finally {
        setUpdatingClaudeRoot(false);
      }
    },
    [
      connectionMode,
      fetchProjects,
      fetchRepositoryGroups,
      loadClaudeRootInfo,
      resetWorkspaceForRootChange,
    ]
  );

  const handleSelectClaudeRootFolder = useCallback(async (): Promise<void> => {
    setClaudeRootError(null);

    const selection = await api.config.selectClaudeRootFolder();
    if (!selection) {
      return;
    }

    if (!selection.isClaudeDirName) {
      const proceed = await confirm({
        title: 'Selected folder is not .claude',
        message: `This folder is named "${selection.path.split(/[\\/]/).pop() ?? selection.path}", not ".claude". Continue anyway?`,
        confirmLabel: 'Use Folder',
      });
      if (!proceed) {
        return;
      }
    }

    if (!selection.hasProjectsDir) {
      const proceed = await confirm({
        title: 'No projects directory found',
        message: 'This folder does not contain a "projects" directory. Continue anyway?',
        confirmLabel: 'Use Folder',
      });
      if (!proceed) {
        return;
      }
    }

    await applyClaudeRootPath(selection.path);
  }, [applyClaudeRootPath]);

  const handleResetClaudeRoot = useCallback(async (): Promise<void> => {
    await applyClaudeRootPath(null);
  }, [applyClaudeRootPath]);

  const applyWslCandidate = useCallback(
    async (candidate: WslClaudeRootCandidate): Promise<void> => {
      if (!candidate.hasProjectsDir) {
        const proceed = await confirm({
          title: 'WSL path missing projects directory',
          message: `"${candidate.path}" does not contain a "projects" directory. Continue anyway?`,
          confirmLabel: 'Use Path',
        });
        if (!proceed) {
          return;
        }
      }

      await applyClaudeRootPath(candidate.path);
      setShowWslModal(false);
    },
    [applyClaudeRootPath]
  );

  const handleUseWslForClaude = useCallback(async (): Promise<void> => {
    try {
      setFindingWslRoots(true);
      setClaudeRootError(null);
      const candidates = await api.config.findWslClaudeRoots();
      setWslCandidates(candidates);

      if (candidates.length === 0) {
        const pickManually = await confirm({
          title: 'No WSL Claude paths found',
          message:
            'Could not find WSL distros with Claude data automatically. Select folder manually?',
          confirmLabel: 'Select Folder',
        });
        if (pickManually) {
          await handleSelectClaudeRootFolder();
        }
        return;
      }

      const candidatesWithProjects = candidates.filter((candidate) => candidate.hasProjectsDir);
      if (candidatesWithProjects.length === 1) {
        await applyWslCandidate(candidatesWithProjects[0]);
        return;
      }

      setShowWslModal(true);
    } catch (error) {
      setClaudeRootError(
        error instanceof Error ? error.message : 'Failed to detect WSL Claude root paths'
      );
    } finally {
      setFindingWslRoots(false);
    }
  }, [applyWslCandidate, handleSelectClaudeRootFolder]);

  const isCustomClaudeRoot = Boolean(claudeRootInfo?.customPath);
  const resolvedClaudeRootPath = claudeRootInfo?.resolvedPath ?? '~/.claude';
  const defaultClaudeRootPath = claudeRootInfo?.defaultPath ?? '~/.claude';
  const isWindowsStyleDefaultPath =
    /^[a-zA-Z]:\\/.test(defaultClaudeRootPath) || defaultClaudeRootPath.startsWith('\\\\');

  const isElectron = useMemo(() => isDesktopMode(), []);

  return (
    <div>
      {isElectron && (
        <>
          <SettingsSectionHeader title="Startup" />
          <SettingRow
            label="Launch at login"
            description="Automatically start the app when you log in"
          >
            <Switch
              checked={safeConfig.general.launchAtLogin}
              onCheckedChange={(v) => onGeneralToggle('launchAtLogin', v)}
              disabled={saving}
            />
          </SettingRow>
          {window.navigator.userAgent.includes('Macintosh') && (
            <SettingRow
              label="Show dock icon"
              description="Display the app icon in the dock (macOS)"
            >
              <Switch
                checked={safeConfig.general.showDockIcon}
                onCheckedChange={(v) => onGeneralToggle('showDockIcon', v)}
                disabled={saving}
              />
            </SettingRow>
          )}
        </>
      )}

      <SettingsSectionHeader title="Appearance" />
      <SettingRow label="Theme" description="Choose your preferred color theme">
        <Select
          value={safeConfig.general.theme}
          onValueChange={(v) => {
            if (v) onThemeChange(v);
          }}
          disabled={saving}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THEME_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow
        label="Expand AI responses by default"
        description="Automatically expand each response turn when opening a transcript or receiving a new message"
      >
        <Switch
          checked={safeConfig.general.autoExpandAIGroups ?? false}
          onCheckedChange={(v) => onGeneralToggle('autoExpandAIGroups', v)}
          disabled={saving}
        />
      </SettingRow>
      {isElectron && !window.navigator.userAgent.includes('Macintosh') && (
        <SettingRow
          label="Use native title bar"
          description="Use the default system window frame instead of the custom title bar"
        >
          <Switch
            checked={safeConfig.general.useNativeTitleBar}
            onCheckedChange={async (v) => {
              const shouldRelaunch = await confirm({
                title: 'Restart required',
                message: 'The app needs to restart to apply the title bar change. Restart now?',
                confirmLabel: 'Restart',
              });
              if (shouldRelaunch) {
                onGeneralToggle('useNativeTitleBar', v);
                // Small delay to let config persist before relaunch
                setTimeout(() => {
                  void api.windowControls?.relaunch();
                }, 200);
              }
            }}
            disabled={saving}
          />
        </SettingRow>
      )}

      <SettingsSectionHeader title="Code Blocks" />
      <SettingRow label="Theme" description="Color scheme for code block backgrounds">
        <Select
          value={safeConfig.display.codeBlockTheme}
          onValueChange={(v) => {
            if (v) onCodeBlockThemeChange(v);
          }}
          disabled={saving}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CODE_BLOCK_THEME_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow
        label="Show line numbers"
        description="Display line numbers in the gutter of code blocks"
      >
        <Switch
          checked={safeConfig.display.showLineNumbers}
          onCheckedChange={(v) => onDisplayToggle('showLineNumbers', v)}
          disabled={saving}
        />
      </SettingRow>
      <SettingRow label="Word wrap" description="Wrap long lines instead of horizontal scrolling">
        <Switch
          checked={safeConfig.display.wordWrap}
          onCheckedChange={(v) => onDisplayToggle('wordWrap', v)}
          disabled={saving}
        />
      </SettingRow>

      {isElectron && (
        <>
          <SettingsSectionHeader title="Local Claude Root" />
          <p className="text-muted-foreground mb-4 text-sm">
            Choose which local folder is treated as your Claude data root
          </p>

          <SettingRow
            label="Current Local Root"
            description={isCustomClaudeRoot ? 'Using custom path' : 'Using auto-detected path'}
          >
            <div className="max-w-96 text-right">
              <div className="text-foreground truncate font-mono text-xs">
                {resolvedClaudeRootPath}
              </div>
              <div className="text-muted-foreground text-[11px]">
                Auto-detected: {defaultClaudeRootPath}
              </div>
            </div>
          </SettingRow>

          <div className="flex items-center gap-3 py-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleSelectClaudeRootFolder()}
              disabled={updatingClaudeRoot}
            >
              {updatingClaudeRoot ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <FolderOpen className="size-3" />
              )}
              Select Folder
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleResetClaudeRoot()}
              disabled={updatingClaudeRoot || !isCustomClaudeRoot}
            >
              <RotateCcw className="size-3" />
              Use Auto-Detect
            </Button>

            {isWindowsStyleDefaultPath && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleUseWslForClaude()}
                disabled={updatingClaudeRoot || findingWslRoots}
              >
                {findingWslRoots ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Laptop className="size-3" />
                )}
                Using Linux/WSL?
              </Button>
            )}
          </div>

          {claudeRootError && (
            <Alert variant="destructive">
              <AlertDescription>{claudeRootError}</AlertDescription>
            </Alert>
          )}

          <Dialog open={showWslModal} onOpenChange={setShowWslModal}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Select WSL Claude Root</DialogTitle>
                <DialogDescription>
                  Detected WSL distributions and Claude root candidates
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                {wslCandidates.map((candidate) => (
                  <div
                    key={`${candidate.distro}:${candidate.path}`}
                    className="border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-foreground text-xs font-medium">{candidate.distro}</p>
                      <p className="text-muted-foreground truncate font-mono text-[11px]">
                        {candidate.path}
                      </p>
                      {!candidate.hasProjectsDir && (
                        <p className="text-[11px] text-amber-400">No projects directory detected</p>
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void applyWslCandidate(candidate)}
                    >
                      Use This Path
                    </Button>
                  </div>
                ))}
              </div>

              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setShowWslModal(false)}>
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setShowWslModal(false);
                    void handleSelectClaudeRootFolder();
                  }}
                >
                  Select Folder Manually
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      {isElectron ? (
        <>
          <SettingsSectionHeader title="Browser Access" />
          <SettingRow
            label="Enable server mode"
            description="Start an HTTP server to access the UI from a browser or embed in iframes"
          >
            {serverLoading ? (
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            ) : (
              <Switch
                checked={serverStatus.running}
                onCheckedChange={handleServerToggle}
                disabled={saving}
              />
            )}
          </SettingRow>

          {serverStatus.running && (
            <div className="bg-card mb-2 flex items-center gap-3 rounded-md px-3 py-2.5">
              <div className="size-2 shrink-0 rounded-full bg-green-500" />
              <span className="text-muted-foreground text-xs font-medium">Running on</span>
              <code className="border-border bg-background text-foreground rounded-sm border px-1.5 py-0.5 font-mono text-xs">
                {serverUrl}
              </code>
              <button
                onClick={handleCopyUrl}
                className={cn(
                  'ml-auto flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/5',
                  copied ? 'text-green-500' : 'text-muted-foreground'
                )}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? 'Copied' : 'Copy URL'}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <SettingsSectionHeader title="Server" />
          <div className="bg-card mb-2 flex items-center gap-3 rounded-md px-3 py-2.5">
            <div className="size-2 shrink-0 rounded-full bg-green-500" />
            <span className="text-muted-foreground text-xs font-medium">Running on</span>
            <code className="border-border bg-background text-foreground rounded-sm border px-1.5 py-0.5 font-mono text-xs">
              {window.location.origin}
            </code>
            <button
              onClick={() => copy(window.location.origin)}
              className={cn(
                'ml-auto flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/5',
                copied ? 'text-green-500' : 'text-muted-foreground'
              )}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? 'Copied' : 'Copy URL'}
            </button>
          </div>
          <p className="text-muted-foreground text-xs">
            Running in standalone mode. The HTTP server is always active. System notifications are
            not available — notification triggers are logged in-app only.
          </p>
        </>
      )}
    </div>
  );
};
