import type {
  Candidate,
  CombinedReport,
  DirUsage,
  GlobalAgent,
  HealthStatus,
  HistoryStats,
  InstructionFile,
  MaintenanceScanProgress,
  MemoryDir,
  MemoryReport,
  ScheduleStatus,
  SkillInventoryEntry,
  TrashReceipt,
  WailsAPI,
} from '@shared/types';

import { bridgeEvent } from '../eventBridge';
import { call } from '../invoke';

// Event wirings owned by the Wails "maintenance" adapter, ported to Tauri
// `listen`. Payload shapes mirror the current Wails adapter exactly.
export const maintenanceEvents = {
  onScanProgress: (callback: (progress: MaintenanceScanProgress) => void): (() => void) =>
    bridgeEvent<MaintenanceScanProgress>('maintenance:scan-progress', callback),
  onMuteWatcher: (callback: (muted: boolean) => void): (() => void) =>
    bridgeEvent<{ muted: boolean }>('maintenance:mute-watcher', (data) => callback(data.muted)),
  onTrashed: (callback: (projects: string[]) => void): (() => void) =>
    bridgeEvent<{ projects: string[] }>('maintenance:trashed', (data) => callback(data.projects)),
  onConfigFileChange: (callback: (path?: string) => void): (() => void) =>
    bridgeEvent<{ path?: string } | undefined>('config-file-change', (data) =>
      callback(data?.path)
    ),
};

// The 41 MaintenanceService data methods (W13). Mirrors the Wails maintenanceApi
// (domain/maintenance.ts) method-for-method, routed through the Tauri invoke
// bridge. reviveDates opts in exactly where the Wails twin does: TrashReceipt,
// DirUsage/Candidate mtimes, and HistoryStats. Config-backup methods (captureConfig,
// listConfigBackups, restoreConfig, deleteConfigBackup, exportBackup,
// validateImportDialog, applyImport) are W14 — deliberately left notPorted.
type MaintenanceCommands = Pick<
  WailsAPI['maintenance'],
  | 'scanClaudeDir'
  | 'cancelScan'
  | 'scanCategory'
  | 'getCutoff'
  | 'setCutoff'
  | 'readPlanFile'
  | 'trashItems'
  | 'listTrash'
  | 'restoreTrash'
  | 'emptyTrash'
  | 'rollbackBinary'
  | 'analyzeHistory'
  | 'pruneHistory'
  | 'clearFiles'
  | 'getMaintenanceHealth'
  | 'getScheduleStatus'
  | 'listSettingsGenerations'
  | 'readSettingsGeneration'
  | 'restoreSettingsGeneration'
  | 'listInstructionFiles'
  | 'readInstructionFile'
  | 'writeInstructionFile'
  | 'deleteInstructionFile'
  | 'listManagedAgents'
  | 'patchAgentFrontmatter'
  | 'createAgent'
  | 'deleteAgent'
  | 'skillsInventory'
  | 'readSkillDoc'
  | 'writeSkillDoc'
  | 'removeSkillLink'
  | 'deleteSkill'
  | 'listMemoryDirs'
  | 'memoryIntegrity'
  | 'readMemoryFile'
  | 'writeMemoryFile'
  | 'applyMemoryIndexFix'
  | 'deleteMemoryFile'
  | 'previewPolicyClean'
  | 'runPolicyClean'
  | 'cancelPolicyClean'
>;

export const maintenanceCommands: MaintenanceCommands = {
  scanClaudeDir: () => call<DirUsage[]>('scan_claude_dir', undefined, { reviveDates: true }),

  cancelScan: () => call<void>('cancel_scan'),

  scanCategory: (id) => call<Candidate[]>('scan_category', { id }, { reviveDates: true }),

  getCutoff: (id) => call<number>('get_maintenance_cutoff', { id }),

  setCutoff: (id, days) => call<void>('set_maintenance_cutoff', { id, days }),

  readPlanFile: (name) => call<string>('read_plan_file', { name }),

  trashItems: (paths) => call<TrashReceipt>('trash_items', { paths }, { reviveDates: true }),

  listTrash: () => call<TrashReceipt[]>('list_trash', undefined, { reviveDates: true }),

  restoreTrash: (id) => call<void>('restore_trash', { id }),

  emptyTrash: (ids) => call<void>('empty_trash', { ids }),

  rollbackBinary: (activePath, backupPath) =>
    call<TrashReceipt>('rollback_binary', { activePath, backupPath }, { reviveDates: true }),

  analyzeHistory: () => call<HistoryStats>('analyze_history', undefined, { reviveDates: true }),

  pruneHistory: (cutoffDays) =>
    call<TrashReceipt>('prune_history', { cutoffDays }, { reviveDates: true }),

  clearFiles: (paths, truncate) => call<void>('clear_files', { paths, truncate }),

  getMaintenanceHealth: () => call<HealthStatus>('get_maintenance_health'),

  getScheduleStatus: () => call<ScheduleStatus>('get_schedule_status'),

  listSettingsGenerations: async () =>
    (await call<string[] | null>('list_settings_generations')) ?? [],

  readSettingsGeneration: (name) => call<string>('read_settings_generation', { name }),

  restoreSettingsGeneration: (name) => call<void>('restore_settings_generation', { name }),

  listInstructionFiles: () => call<InstructionFile[]>('list_instruction_files'),

  readInstructionFile: (relPath) => call<string>('read_instruction_file', { relPath }),

  writeInstructionFile: (relPath, content) =>
    call<void>('write_instruction_file', { relPath, content }),

  deleteInstructionFile: (relPath) =>
    call<TrashReceipt>('delete_instruction_file', { relPath }, { reviveDates: true }),

  listManagedAgents: () => call<GlobalAgent[]>('list_managed_agents'),

  patchAgentFrontmatter: (fileBase, patch) =>
    call<void>('patch_agent_frontmatter', { fileBase, patch }),

  createAgent: (name, description) => call<void>('create_agent', { name, description }),

  deleteAgent: (fileBase) => call<TrashReceipt>('delete_agent', { fileBase }, { reviveDates: true }),

  skillsInventory: () => call<SkillInventoryEntry[]>('skills_inventory'),

  readSkillDoc: (skillName) => call<string>('read_skill_doc', { skillName }),

  writeSkillDoc: (skillName, content) => call<void>('write_skill_doc', { skillName, content }),

  removeSkillLink: (skillName) =>
    call<TrashReceipt>('remove_skill_link', { skillName }, { reviveDates: true }),

  deleteSkill: (skillName) =>
    call<TrashReceipt>('delete_skill', { skillName }, { reviveDates: true }),

  listMemoryDirs: () => call<MemoryDir[]>('list_memory_dirs'),

  memoryIntegrity: (dirId) => call<MemoryReport>('memory_integrity', { dirId }),

  readMemoryFile: (dirId, fileName) => call<string>('read_memory_file', { dirId, fileName }),

  writeMemoryFile: (dirId, fileName, content) =>
    call<void>('write_memory_file', { dirId, fileName, content }),

  applyMemoryIndexFix: (dirId, fix) => call<void>('apply_memory_index_fix', { dirId, fix }),

  deleteMemoryFile: (dirId, fileName) =>
    call<TrashReceipt>('delete_memory_file', { dirId, fileName }, { reviveDates: true }),

  previewPolicyClean: () => call<CombinedReport>('preview_policy_clean'),

  runPolicyClean: () => call<CombinedReport>('run_policy_clean'),

  cancelPolicyClean: () => call<void>('cancel_policy_clean'),
};
