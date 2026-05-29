import React from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { createLogger } from '@shared/utils/logger';
import { FolderOpen } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

const logger = createLogger('Component:DashboardView');

export const NewProjectCard = (): React.JSX.Element => {
  const { repositoryGroups, selectRepository } = useStore(
    useShallow((s) => ({
      repositoryGroups: s.repositoryGroups,
      selectRepository: s.selectRepository,
    }))
  );

  const handleClick = async (): Promise<void> => {
    try {
      const selectedPaths = await api.config.selectFolders();
      if (!selectedPaths || selectedPaths.length === 0) {
        return; // User cancelled
      }

      const selectedPath = selectedPaths[0];

      // Match selected path against known repository worktrees
      for (const repo of repositoryGroups) {
        for (const worktree of repo.worktrees) {
          if (worktree.path === selectedPath) {
            selectRepository(repo.id);
            return;
          }
        }
      }

      // No match found - open the folder in file manager as fallback
      const result = await api.openPath(selectedPath);
      if (!result.success) {
        logger.error('Failed to open folder:', result.error);
      }
    } catch (error) {
      logger.error('Error selecting folder:', error);
    }
  };

  return (
    <button
      className="hover:bg-background/30 group border-border relative flex min-h-[120px] flex-col items-center justify-center rounded-xs border border-dashed bg-transparent p-4 transition-all duration-300"
      onClick={handleClick}
      title="Select a project folder"
    >
      <div className="border-border mb-2 flex size-8 items-center justify-center rounded-xs border border-dashed transition-colors duration-300">
        <FolderOpen className="text-muted-foreground size-4 transition-colors" />
      </div>
      <span className="text-muted-foreground text-xs transition-colors">Select Folder</span>
    </button>
  );
};
