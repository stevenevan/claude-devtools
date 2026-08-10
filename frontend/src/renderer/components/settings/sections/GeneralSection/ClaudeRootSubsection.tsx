import { JSX, useCallback, useEffect, useState } from 'react';
import { api } from '@renderer/api';
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
import { useStore } from '@renderer/store';
import { getFullResetState } from '@renderer/store/utils/stateResetHelpers';
import { FolderOpen, Laptop, Loader2, RotateCcw } from 'lucide-react';

import { SettingRow, SettingsSectionHeader } from '../../components';

import type { ClaudeRootInfo, WslClaudeRootCandidate } from '@shared/types';

interface ClaudeRootSubsectionProps {
  readonly simple?: boolean;
  readonly anchorId?: string;
}

export const ClaudeRootSubsection = ({
  simple = false,
  anchorId,
}: ClaudeRootSubsectionProps): JSX.Element => {
  const connectionMode = useStore((s) => s.connectionMode);
  const fetchProjects = useStore((s) => s.fetchProjects);
  const fetchRepositoryGroups = useStore((s) => s.fetchRepositoryGroups);

  const [claudeRootInfo, setClaudeRootInfo] = useState<ClaudeRootInfo | null>(null);
  const [updatingClaudeRoot, setUpdatingClaudeRoot] = useState(false);
  const [claudeRootError, setClaudeRootError] = useState<string | null>(null);
  const [findingWslRoots, setFindingWslRoots] = useState(false);
  const [wslCandidates, setWslCandidates] = useState<WslClaudeRootCandidate[]>([]);
  const [showWslModal, setShowWslModal] = useState(false);

  // ponytail: useCallback required — in useEffect dep array
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

  // ponytail: useCallback required — in applyClaudeRootPath dep array
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

  // ponytail: useCallback required — used in dependent useCallback dep arrays
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

  // ponytail: useCallback required — in handleUseWslForClaude dep array
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

  const handleResetClaudeRoot = async (): Promise<void> => {
    await applyClaudeRootPath(null);
  };

  // ponytail: useCallback required — in handleUseWslForClaude dep array
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

  const handleUseWslForClaude = async (): Promise<void> => {
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
  };

  const isCustomClaudeRoot = Boolean(claudeRootInfo?.customPath);
  const resolvedClaudeRootPath = claudeRootInfo?.resolvedPath ?? '~/.claude';
  const defaultClaudeRootPath = claudeRootInfo?.defaultPath ?? '~/.claude';
  const isWindowsStyleDefaultPath =
    /^[a-zA-Z]:\\/.test(defaultClaudeRootPath) || defaultClaudeRootPath.startsWith('\\\\');

  if (simple) {
    return (
      <div>
        <SettingsSectionHeader title="Claude data folder" anchorId={anchorId} />
        <p className="text-muted-foreground mb-4 text-sm">
          Choose the local folder where Claude keeps its data.
        </p>

        <div className="border-border/50 flex flex-wrap items-center justify-between gap-3 border-b py-3">
          <div>
            <div className="text-foreground text-sm font-medium">Current folder</div>
            <div className="text-muted-foreground text-xs">
              {isCustomClaudeRoot ? 'Custom folder selected' : 'Using the default folder'}
            </div>
          </div>
          <div className="flex items-center gap-2">
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
            {isCustomClaudeRoot && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleResetClaudeRoot()}
                disabled={updatingClaudeRoot}
              >
                <RotateCcw className="size-3" />
                Use Default
              </Button>
            )}
          </div>
        </div>

        {claudeRootError && (
          <Alert className="mt-3" variant="destructive">
            <AlertDescription>{claudeRootError}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <>
      <SettingsSectionHeader title="Local Claude Root" />
      <p className="text-muted-foreground mb-4 text-sm">
        Choose which local folder is treated as your Claude data root
      </p>

      <SettingRow
        anchorId={anchorId}
        label="Current Local Root"
        description={isCustomClaudeRoot ? 'Using custom path' : 'Using auto-detected path'}
      >
        <div className="max-w-96 text-right">
          <div className="text-foreground truncate font-mono text-xs">{resolvedClaudeRootPath}</div>
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
  );
};
