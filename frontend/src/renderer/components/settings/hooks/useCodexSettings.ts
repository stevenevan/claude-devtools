import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@renderer/api';
import { useStore } from '@renderer/store';

import type {
  CodexSettingsApplyResult,
  CodexSettingsContext,
  CodexSettingsPatch,
  CodexSettingsPreviewResult,
  CodexSettingsView,
} from '@shared/types/api';

interface UseCodexSettingsResult {
  readonly view: CodexSettingsView | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly writeError: string | null;
  readonly writeBusy: boolean;
  readonly projectRoot: string | null;
  readonly profile: string | null;
  readonly context: CodexSettingsContext | null;
  readonly setProfile: (profile: string | null) => void;
  readonly refresh: () => Promise<void>;
  readonly openConfigFolder: () => Promise<void>;
  readonly previewPatch: (
    patch: CodexSettingsPatch,
    expectedRevision: string
  ) => Promise<CodexSettingsPreviewResult>;
  readonly applyPatch: (
    patch: CodexSettingsPatch,
    expectedRevision: string
  ) => Promise<CodexSettingsApplyResult>;
  readonly clearWriteError: () => void;
}

export function useCodexSettings(): UseCodexSettingsResult {
  const projects = useStore((state) => state.projects);
  const selectedProjectId = useStore((state) => state.selectedProjectId);
  const projectsLoading = useStore((state) => state.projectsLoading);
  const fetchProjects = useStore((state) => state.fetchProjects);
  const [profile, setProfile] = useState<string | null>(null);
  const [view, setView] = useState<CodexSettingsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const projectRoot = useMemo(() => {
    const selected = projects.find((project) => project.id === selectedProjectId);
    return selected?.path ?? projects[0]?.path ?? null;
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (projects.length === 0 && !projectsLoading) void fetchProjects();
  }, [fetchProjects, projects.length, projectsLoading]);

  const context = useMemo<CodexSettingsContext | null>(() => {
    if (!projectRoot) return null;
    return {
      projectRoot,
      workingDirectory: projectRoot,
      profile,
    };
  }, [profile, projectRoot]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!context) {
      setView(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setView(await api.getCodexSettings(context));
    } catch (cause) {
      setView(null);
      setError(cause instanceof Error ? cause.message : 'Could not load Codex settings');
    } finally {
      setLoading(false);
    }
  }, [context]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openConfigFolder = useCallback(async (): Promise<void> => {
    try {
      await api.openCodexConfigFolder();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open the Codex config folder');
    }
  }, []);

  const previewPatch = useCallback(
    async (
      patch: CodexSettingsPatch,
      expectedRevision: string
    ): Promise<CodexSettingsPreviewResult> => {
      if (!context) {
        const message = 'Select a project before reviewing Codex settings changes';
        setWriteError(message);
        throw new Error(message);
      }
      setWriteBusy(true);
      setWriteError(null);
      try {
        return await api.previewCodexSettingsPatch(context, patch, expectedRevision);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Could not review Codex settings changes';
        setWriteError(message);
        throw cause;
      } finally {
        setWriteBusy(false);
      }
    },
    [context]
  );

  const applyPatch = useCallback(
    async (
      patch: CodexSettingsPatch,
      expectedRevision: string
    ): Promise<CodexSettingsApplyResult> => {
      if (!context) {
        const message = 'Select a project before applying Codex settings changes';
        setWriteError(message);
        throw new Error(message);
      }
      setWriteBusy(true);
      setWriteError(null);
      try {
        return await api.applyCodexSettingsPatch(context, patch, expectedRevision);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Could not apply Codex settings changes';
        setWriteError(message);
        throw cause;
      } finally {
        setWriteBusy(false);
      }
    },
    [context]
  );

  const clearWriteError = useCallback(() => setWriteError(null), []);

  return {
    view,
    loading,
    error,
    writeError,
    writeBusy,
    projectRoot,
    profile,
    context,
    setProfile,
    refresh,
    openConfigFolder,
    previewPatch,
    applyPatch,
    clearWriteError,
  };
}
