import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type { AppState } from '../types';
import type {
  Candidate,
  DirUsage,
  HealthStatus,
  HistoryStats,
  MaintenanceScanProgress,
  SimpleCleanupPreview,
  SimpleCleanupRunReport,
  SimpleStorageSummary,
  TrashReceipt,
} from '@shared/types';
import type { StateCreator } from 'zustand';

const logger = createLogger('Store:maintenance');

const LOCAL_ONLY_ERROR = 'Storage maintenance operates on this local machine only';

export interface MaintenanceSlice {
  dirs: DirUsage[];
  scanning: boolean;
  error: string | null;
  progress: MaintenanceScanProgress | null;
  receipts: TrashReceipt[];
  trashLoading: boolean;
  trashError: string | null;

  // Per-category cleanup state (Week 3+), keyed by leaf category id.
  categoryCandidates: Record<string, Candidate[]>;
  categoryScanning: boolean;
  categoryError: string | null;
  cutoffDays: Record<string, number>;

  // history.jsonl retention state (Week 10).
  historyStats: HistoryStats | null;

  // Read-only health snapshot (Week 14).
  health: HealthStatus | null;

  // settings.json generation names (settings.json / .bak / .pre-ponytail) for
  // the diff/restore panel (Week 15).
  settingsGenerations: string[];

  // Simple-mode cleanup is a backend-owned preview/token flow. It never uses
  // categoryCandidates, which remain the Nerd-panel state.
  simpleCleanupPreview: SimpleCleanupPreview | null;
  simpleCleanupScanning: boolean;
  simpleCleanupRunning: boolean;
  simpleCleanupError: string | null;
  simpleStorageSummary: SimpleStorageSummary | null;

  scanStorage: () => Promise<void>;
  cancelScan: () => Promise<void>;
  setMaintenanceProgress: (progress: MaintenanceScanProgress) => void;
  scanCategory: (id: string) => Promise<void>;
  previewSimpleCleanup: () => Promise<void>;
  runSimpleCleanup: () => Promise<SimpleCleanupRunReport | null>;
  clearSimpleCleanupPreview: () => void;
  loadCutoff: (id: string) => Promise<void>;
  setCutoff: (id: string, days: number) => Promise<void>;
  loadTrash: () => Promise<void>;
  trashItems: (paths: string[]) => Promise<TrashReceipt | null>;
  restoreTrash: (id: string) => Promise<void>;
  emptyTrash: (ids: string[]) => Promise<void>;
  rollbackBinary: (activePath: string, backupPath: string) => Promise<TrashReceipt | null>;
  analyzeHistory: () => Promise<void>;
  pruneHistory: (cutoffDays: number) => Promise<TrashReceipt | null>;
  clearFiles: (paths: string[], truncate: boolean, rescanIds?: string[]) => Promise<void>;
  loadHealth: () => Promise<void>;
  loadSettingsGenerations: () => Promise<void>;
  restoreSettingsGeneration: (name: string) => Promise<void>;
}

export const createMaintenanceSlice: StateCreator<AppState, [], [], MaintenanceSlice> = (
  set,
  get
) => ({
  dirs: [],
  scanning: false,
  error: null,
  progress: null,
  receipts: [],
  trashLoading: false,
  trashError: null,

  categoryCandidates: {},
  categoryScanning: false,
  categoryError: null,
  cutoffDays: {},

  historyStats: null,

  health: null,

  settingsGenerations: [],

  simpleCleanupPreview: null,
  simpleCleanupScanning: false,
  simpleCleanupRunning: false,
  simpleCleanupError: null,
  simpleStorageSummary: null,

  scanStorage: async () => {
    if (get().connectionMode !== 'local') {
      set({ error: 'Storage maintenance operates on this local machine only' });
      return;
    }

    set({ scanning: true, error: null, progress: null, simpleStorageSummary: null });
    try {
      const dirs = await api.maintenance.scanClaudeDir();
      set({ dirs, scanning: false, simpleStorageSummary: null });
    } catch (err) {
      logger.error('Failed to scan storage:', err);
      set({ scanning: false, error: err instanceof Error ? err.message : String(err) });
    }
  },

  cancelScan: async () => {
    try {
      await api.maintenance.cancelScan();
    } catch (err) {
      logger.error('Failed to cancel scan:', err);
    }
  },

  setMaintenanceProgress: (progress) => {
    set({ progress });
  },

  scanCategory: async (id) => {
    if (get().connectionMode !== 'local') {
      set({ categoryError: LOCAL_ONLY_ERROR });
      return;
    }
    set({ categoryScanning: true, categoryError: null });
    try {
      const candidates = await api.maintenance.scanCategory(id);
      set((s) => ({
        categoryCandidates: { ...s.categoryCandidates, [id]: candidates },
        categoryScanning: false,
      }));
    } catch (err) {
      logger.error(`Failed to scan category ${id}:`, err);
      set({
        categoryScanning: false,
        categoryError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  previewSimpleCleanup: async () => {
    if (get().connectionMode !== 'local') {
      set({
        simpleCleanupPreview: null,
        simpleCleanupScanning: false,
        simpleCleanupError: LOCAL_ONLY_ERROR,
      });
      return;
    }

    // A fresh request invalidates the previous token before it starts.
    set({ simpleCleanupPreview: null, simpleCleanupScanning: true, simpleCleanupError: null });
    try {
      const simpleCleanupPreview = await api.maintenance.previewSimpleCleanup();
      set({ simpleCleanupPreview, simpleCleanupScanning: false });
    } catch (err) {
      logger.error('Failed to preview simple cleanup:', err);
      set({
        simpleCleanupPreview: null,
        simpleCleanupScanning: false,
        simpleCleanupError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  runSimpleCleanup: async () => {
    if (get().connectionMode !== 'local') {
      set({ simpleCleanupPreview: null, simpleCleanupError: LOCAL_ONLY_ERROR });
      return null;
    }
    const token = get().simpleCleanupPreview?.token;
    if (!token) {
      set({ simpleCleanupPreview: null, simpleCleanupError: 'Cleanup preview expired; refresh' });
      return null;
    }

    set({ simpleCleanupRunning: true, simpleCleanupError: null });
    try {
      const report = await api.maintenance.runSimpleCleanup(token);
      set({
        simpleCleanupPreview: null,
        simpleCleanupRunning: false,
        simpleStorageSummary: report.storage,
      });
      return report;
    } catch (err) {
      logger.error('Failed to run simple cleanup:', err);
      set({
        simpleCleanupPreview: null,
        simpleCleanupRunning: false,
        simpleCleanupError: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  },

  clearSimpleCleanupPreview: () => {
    set({ simpleCleanupPreview: null, simpleCleanupError: null });
  },

  loadCutoff: async (id) => {
    try {
      const days = await api.maintenance.getCutoff(id);
      set((s) => ({ cutoffDays: { ...s.cutoffDays, [id]: days } }));
    } catch (err) {
      logger.error(`Failed to load cutoff ${id}:`, err);
    }
  },

  setCutoff: async (id, days) => {
    try {
      await api.maintenance.setCutoff(id, days);
      set((s) => ({ cutoffDays: { ...s.cutoffDays, [id]: days } }));
      await get().scanCategory(id);
    } catch (err) {
      logger.error(`Failed to set cutoff ${id}:`, err);
      set({ categoryError: err instanceof Error ? err.message : String(err) });
    }
  },

  loadTrash: async () => {
    if (get().connectionMode !== 'local') {
      set({ trashError: LOCAL_ONLY_ERROR });
      return;
    }

    set({ trashLoading: true, trashError: null });
    try {
      const receipts = await api.maintenance.listTrash();
      set({ receipts, trashLoading: false });
    } catch (err) {
      logger.error('Failed to list trash:', err);
      set({ trashLoading: false, trashError: err instanceof Error ? err.message : String(err) });
    }
  },

  trashItems: async (paths) => {
    if (get().connectionMode !== 'local') {
      set({ trashError: LOCAL_ONLY_ERROR });
      return null;
    }

    set({ trashLoading: true, trashError: null });
    try {
      const receipt = await api.maintenance.trashItems(paths);
      await get().loadTrash();
      return receipt;
    } catch (err) {
      logger.error('Failed to trash items:', err);
      set({ trashError: err instanceof Error ? err.message : String(err) });
      // A batch can fail partway through; the manifest only records items that
      // actually moved, so refresh to reflect whatever really landed in trash.
      await get().loadTrash();
      return null;
    }
  },

  restoreTrash: async (id) => {
    if (get().connectionMode !== 'local') {
      set({ trashError: LOCAL_ONLY_ERROR });
      return;
    }

    set({ trashLoading: true, trashError: null });
    try {
      await api.maintenance.restoreTrash(id);
      await get().loadTrash();
    } catch (err) {
      logger.error('Failed to restore trash:', err);
      set({ trashLoading: false, trashError: err instanceof Error ? err.message : String(err) });
    }
  },

  emptyTrash: async (ids) => {
    if (get().connectionMode !== 'local') {
      set({ trashError: LOCAL_ONLY_ERROR });
      return;
    }

    set({ trashLoading: true, trashError: null });
    try {
      await api.maintenance.emptyTrash(ids);
      await get().loadTrash();
    } catch (err) {
      logger.error('Failed to empty trash:', err);
      set({ trashLoading: false, trashError: err instanceof Error ? err.message : String(err) });
    }
  },

  rollbackBinary: async (activePath, backupPath) => {
    if (get().connectionMode !== 'local') {
      set({ trashError: LOCAL_ONLY_ERROR });
      return null;
    }

    set({ trashLoading: true, trashError: null });
    try {
      const receipt = await api.maintenance.rollbackBinary(activePath, backupPath);
      await get().scanCategory('backup-binaries');
      set({ trashLoading: false });
      return receipt;
    } catch (err) {
      logger.error('Failed to rollback binary:', err);
      set({ trashLoading: false, trashError: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  analyzeHistory: async () => {
    if (get().connectionMode !== 'local') {
      set({ trashError: LOCAL_ONLY_ERROR });
      return;
    }

    set({ trashLoading: true, trashError: null });
    try {
      const historyStats = await api.maintenance.analyzeHistory();
      set({ historyStats, trashLoading: false });
    } catch (err) {
      logger.error('Failed to analyze history:', err);
      set({ trashLoading: false, trashError: err instanceof Error ? err.message : String(err) });
    }
  },

  pruneHistory: async (cutoffDays) => {
    if (get().connectionMode !== 'local') {
      set({ trashError: LOCAL_ONLY_ERROR });
      return null;
    }

    set({ trashLoading: true, trashError: null });
    try {
      const receipt = await api.maintenance.pruneHistory(cutoffDays);
      await get().analyzeHistory();
      return receipt;
    } catch (err) {
      logger.error('Failed to prune history:', err);
      set({ trashLoading: false, trashError: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  clearFiles: async (paths, truncate, rescanIds) => {
    if (get().connectionMode !== 'local') {
      set({ trashError: LOCAL_ONLY_ERROR });
      return;
    }

    set({ trashLoading: true, trashError: null });
    try {
      await api.maintenance.clearFiles(paths, truncate);
      for (const id of rescanIds ?? []) {
        await get().scanCategory(id);
      }
      set({ trashLoading: false });
    } catch (err) {
      logger.error('Failed to clear files:', err);
      set({ trashLoading: false, trashError: err instanceof Error ? err.message : String(err) });
    }
  },

  loadHealth: async () => {
    try {
      const health = await api.maintenance.getMaintenanceHealth();
      set({ health });
    } catch (err) {
      logger.error('Failed to load maintenance health:', err);
    }
  },

  loadSettingsGenerations: async () => {
    try {
      const settingsGenerations = await api.maintenance.listSettingsGenerations();
      set({ settingsGenerations });
    } catch (err) {
      logger.error('Failed to load settings generations:', err);
    }
  },

  restoreSettingsGeneration: async (name) => {
    if (get().connectionMode !== 'local') {
      set({ trashError: LOCAL_ONLY_ERROR });
      return;
    }

    set({ trashLoading: true, trashError: null });
    try {
      await api.maintenance.restoreSettingsGeneration(name);
      await get().loadSettingsGenerations();
      set({ trashLoading: false });
    } catch (err) {
      logger.error('Failed to restore settings generation:', err);
      set({ trashLoading: false, trashError: err instanceof Error ? err.message : String(err) });
    }
  },
});
