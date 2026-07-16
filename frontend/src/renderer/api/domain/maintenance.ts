import { Events } from '@wailsio/runtime';

import {
  AnalyzeHistory,
  ApplyImport,
  ApplyMemoryIndexFix,
  CancelPolicyClean,
  CancelScan,
  CaptureConfig,
  ClearFiles,
  CreateAgent,
  DeleteAgent,
  DeleteConfigBackup,
  DeleteInstructionFile,
  DeleteMemoryFile,
  DeleteSkill,
  EmptyTrash,
  ExportBackup,
  GetMaintenanceCutoff,
  GetMaintenanceHealth,
  GetScheduleStatus,
  ListInstructionFiles,
  ListConfigBackups,
  ListManagedAgents,
  ListMemoryDirs,
  ListSettingsGenerations,
  ListTrash,
  MemoryIntegrity,
  PatchAgentFrontmatter,
  PreviewPolicyClean,
  PruneHistory,
  ReadInstructionFile,
  ReadMemoryFile,
  ReadPlanFile,
  ReadSettingsGeneration,
  ReadSkillDoc,
  RemoveSkillLink,
  RestoreConfig,
  RestoreSettingsGeneration,
  RestoreTrash,
  RollbackBinary,
  RunPolicyClean,
  ScanCategory,
  ScanClaudeDir,
  SetMaintenanceCutoff,
  SkillsInventory,
  TrashItems,
  ValidateImportDialog,
  WriteInstructionFile,
  WriteMemoryFile,
  WriteSkillDoc,
} from '../../../../bindings/claude-devtools/internal/maintenanceservice/maintenanceservice';

import { reviveDates } from '../reviveDates';

import type {
  AgentPatch,
  Candidate,
  CombinedReport,
  DirUsage,
  WailsAPI,
  GlobalAgent,
  HealthStatus,
  HistoryStats,
  ImportPreview,
  InstructionFile,
  MaintenanceScanProgress,
  Manifest,
  MemoryDir,
  MemoryIndexFix,
  MemoryReport,
  ScheduleStatus,
  SkillInventoryEntry,
  TrashReceipt,
} from '@shared/types';

type MaintenanceSlice = Pick<WailsAPI, 'maintenance'>;

export const maintenanceApi: MaintenanceSlice = {
  maintenance: {
    scanClaudeDir: async (): Promise<DirUsage[]> => {
      const raw = await ScanClaudeDir();
      return reviveDates(raw as unknown as DirUsage[]);
    },

    cancelScan: (): Promise<void> => CancelScan(),

    scanCategory: async (id: string): Promise<Candidate[]> => {
      const raw = await ScanCategory(id);
      return reviveDates(raw as unknown as Candidate[]);
    },

    getCutoff: (id: string): Promise<number> => GetMaintenanceCutoff(id),

    setCutoff: (id: string, days: number): Promise<void> => SetMaintenanceCutoff(id, days),

    readPlanFile: (name: string): Promise<string> => ReadPlanFile(name),

    onScanProgress: (callback: (progress: MaintenanceScanProgress) => void): (() => void) => {
      const off = Events.On('maintenance:scan-progress', (e) => {
        callback(e.data as MaintenanceScanProgress);
      });
      return off;
    },

    trashItems: async (paths: string[]): Promise<TrashReceipt> => {
      const raw = await TrashItems(paths);
      return reviveDates(raw as unknown as TrashReceipt);
    },

    listTrash: async (): Promise<TrashReceipt[]> => {
      const raw = await ListTrash();
      return reviveDates(raw as unknown as TrashReceipt[]);
    },

    restoreTrash: (id: string): Promise<void> => RestoreTrash(id),

    emptyTrash: (ids: string[]): Promise<void> => EmptyTrash(ids),

    onMuteWatcher: (callback: (muted: boolean) => void): (() => void) => {
      const off = Events.On('maintenance:mute-watcher', (e) => {
        callback((e.data as { muted: boolean }).muted);
      });
      return off;
    },

    rollbackBinary: async (activePath: string, backupPath: string): Promise<TrashReceipt> => {
      const raw = await RollbackBinary(activePath, backupPath);
      return reviveDates(raw as unknown as TrashReceipt);
    },

    analyzeHistory: async (): Promise<HistoryStats> => {
      const raw = await AnalyzeHistory();
      return reviveDates(raw as unknown as HistoryStats);
    },

    pruneHistory: async (cutoffDays: number): Promise<TrashReceipt> => {
      const raw = await PruneHistory(cutoffDays);
      return reviveDates(raw as unknown as TrashReceipt);
    },

    onTrashed: (callback: (projects: string[]) => void): (() => void) => {
      const off = Events.On('maintenance:trashed', (e) => {
        callback((e.data as { projects: string[] }).projects);
      });
      return off;
    },

    clearFiles: (paths: string[], truncate: boolean): Promise<void> => ClearFiles(paths, truncate),

    getMaintenanceHealth: async (): Promise<HealthStatus> => {
      const raw = await GetMaintenanceHealth();
      return raw as unknown as HealthStatus;
    },

    getScheduleStatus: async (): Promise<ScheduleStatus> => {
      const raw = await GetScheduleStatus();
      return raw as unknown as ScheduleStatus;
    },

    listSettingsGenerations: (): Promise<string[]> => ListSettingsGenerations(),

    readSettingsGeneration: (name: string): Promise<string> => ReadSettingsGeneration(name),

    restoreSettingsGeneration: (name: string): Promise<void> => RestoreSettingsGeneration(name),

    onConfigFileChange: (callback: (path?: string) => void): (() => void) => {
      const off = Events.On('config-file-change', (e) => {
        callback((e.data as { path?: string } | undefined)?.path);
      });
      return off;
    },

    listInstructionFiles: async (): Promise<InstructionFile[]> => {
      const raw = await ListInstructionFiles();
      return raw as unknown as InstructionFile[];
    },

    readInstructionFile: (relPath: string): Promise<string> => ReadInstructionFile(relPath),

    writeInstructionFile: (relPath: string, content: string): Promise<void> =>
      WriteInstructionFile(relPath, content),

    deleteInstructionFile: async (relPath: string): Promise<TrashReceipt> => {
      const raw = await DeleteInstructionFile(relPath);
      return reviveDates(raw as unknown as TrashReceipt);
    },

    listManagedAgents: (): Promise<GlobalAgent[]> =>
      ListManagedAgents() as unknown as Promise<GlobalAgent[]>,

    patchAgentFrontmatter: (fileBase: string, patch: AgentPatch): Promise<void> =>
      PatchAgentFrontmatter(
        fileBase,
        patch as unknown as Parameters<typeof PatchAgentFrontmatter>[1]
      ) as unknown as Promise<void>,

    createAgent: (name: string, description: string): Promise<void> => CreateAgent(name, description),

    deleteAgent: async (fileBase: string): Promise<TrashReceipt> => {
      const raw = await DeleteAgent(fileBase);
      return reviveDates(raw as unknown as TrashReceipt);
    },

    skillsInventory: (): Promise<SkillInventoryEntry[]> =>
      SkillsInventory() as unknown as Promise<SkillInventoryEntry[]>,

    readSkillDoc: (skillName: string): Promise<string> => ReadSkillDoc(skillName),

    writeSkillDoc: (skillName: string, content: string): Promise<void> =>
      WriteSkillDoc(skillName, content),

    removeSkillLink: async (skillName: string): Promise<TrashReceipt> => {
      const raw = await RemoveSkillLink(skillName);
      return reviveDates(raw as unknown as TrashReceipt);
    },

    deleteSkill: async (skillName: string): Promise<TrashReceipt> => {
      const raw = await DeleteSkill(skillName);
      return reviveDates(raw as unknown as TrashReceipt);
    },

    listMemoryDirs: (): Promise<MemoryDir[]> =>
      ListMemoryDirs() as unknown as Promise<MemoryDir[]>,

    memoryIntegrity: (dirID: string): Promise<MemoryReport> =>
      MemoryIntegrity(dirID) as unknown as Promise<MemoryReport>,

    readMemoryFile: (dirID: string, fileName: string): Promise<string> =>
      ReadMemoryFile(dirID, fileName),

    writeMemoryFile: (dirID: string, fileName: string, content: string): Promise<void> =>
      WriteMemoryFile(dirID, fileName, content),

    applyMemoryIndexFix: (dirID: string, fix: MemoryIndexFix): Promise<void> =>
      ApplyMemoryIndexFix(
        dirID,
        fix as unknown as Parameters<typeof ApplyMemoryIndexFix>[1]
      ) as unknown as Promise<void>,

    deleteMemoryFile: async (dirID: string, fileName: string): Promise<TrashReceipt> => {
      const raw = await DeleteMemoryFile(dirID, fileName);
      return reviveDates(raw as unknown as TrashReceipt);
    },

    // createdMs is a plain number, not an ISO date — never reviveDates these.
    captureConfig: (label: string): Promise<Manifest> =>
      CaptureConfig(label) as unknown as Promise<Manifest>,

    listConfigBackups: (): Promise<Manifest[]> =>
      ListConfigBackups() as unknown as Promise<Manifest[]>,

    restoreConfig: (id: string, relPaths: string[]): Promise<void> => RestoreConfig(id, relPaths),

    deleteConfigBackup: (id: string): Promise<void> => DeleteConfigBackup(id),

    exportBackup: (id: string, includeSecrets: boolean): Promise<void> =>
      ExportBackup(id, includeSecrets),

    validateImportDialog: (): Promise<ImportPreview> =>
      ValidateImportDialog() as unknown as Promise<ImportPreview>,

    applyImport: (archivePath: string, confirmedCategories: string[]): Promise<void> =>
      ApplyImport(archivePath, confirmedCategories),

    // CombinedReport has no Date fields — plain cast, never reviveDates.
    previewPolicyClean: (): Promise<CombinedReport> =>
      PreviewPolicyClean() as unknown as Promise<CombinedReport>,

    runPolicyClean: (): Promise<CombinedReport> =>
      RunPolicyClean() as unknown as Promise<CombinedReport>,

    cancelPolicyClean: (): Promise<void> => CancelPolicyClean(),
  },
};
