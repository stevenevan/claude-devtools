import { beforeAll, expect, mock, test } from 'bun:test';

// The event bridge calls `@tauri-apps/api/event` `listen`, which is absent in the
// bun-test runtime. Stub it so event subscriptions resolve instead of throwing
// for the WRONG reason — this gate asserts the only failure it cares about is the
// `createTauriClient` "not ported yet" thrower, per week's PORTED allowlist.
mock.module('@tauri-apps/api/event', () => ({
  listen: async () => () => {},
  emit: async () => {},
}));

// Data methods route through `invoke`, also absent in the bun runtime — stub it
// so a wired data method resolves instead of throwing an invoke error.
mock.module('@tauri-apps/api/core', () => ({
  invoke: async () => null,
}));

const NOT_PORTED = /not ported yet/;

// PORTED allowlist — grows each porting week. W3: events only (wired via the
// Tauri `listen` bridge in Cycle A). W7 adds the flat session + search data
// methods (getSessionDetail, searchSessions, …).
const PORTED: Array<[string, (api: any) => unknown]> = [
  ['onFileChange', (a) => a.onFileChange(() => {})],
  ['onTodoChange', (a) => a.onTodoChange(() => {})],
  ['onZoomFactorChanged', (a) => a.onZoomFactorChanged(() => {})],
  ['onSessionRefresh', (a) => a.onSessionRefresh(() => {})],
  ['ssh.onStatus', (a) => a.ssh.onStatus(() => {})],
  ['context.onChanged', (a) => a.context.onChanged(() => {})],
  ['maintenance.onScanProgress', (a) => a.maintenance.onScanProgress(() => {})],
  ['maintenance.onMuteWatcher', (a) => a.maintenance.onMuteWatcher(() => {})],
  ['maintenance.onTrashed', (a) => a.maintenance.onTrashed(() => {})],
  ['maintenance.onConfigFileChange', (a) => a.maintenance.onConfigFileChange(() => {})],
  ['notifications.onNew', (a) => a.notifications.onNew(() => {})],
  ['notifications.onUpdated', (a) => a.notifications.onUpdated(() => {})],
  ['notifications.onClicked', (a) => a.notifications.onClicked(() => {})],
  // W7: first flat data method wired via the invoke bridge.
  ['getSessionDetail', (a) => a.getSessionDetail('p', 's')],
  // W8: flat analytics + backend-observability methods.
  ['getAnalytics', (a) => a.getAnalytics(30)],
  ['getCostForecast', (a) => a.getCostForecast(14)],
  ['getProductivityMetrics', (a) => a.getProductivityMetrics(30)],
  ['getSessionDurationStats', (a) => a.getSessionDurationStats(30)],
  ['getModelComparison', (a) => a.getModelComparison(30)],
  ['getBackendTimings', (a) => a.getBackendTimings()],
  ['getCacheStats', (a) => a.getCacheStats()],
  ['setCacheCapacity', (a) => a.setCacheCapacity(100)],
  ['clearSessionCache', (a) => a.clearSessionCache()],
  // W9: insights methods (closes the W8 deferral) + snapshots slice.
  ['getFileGraph', (a) => a.getFileGraph('p', 's')],
  ['getToolAnalytics', (a) => a.getToolAnalytics('p', 30)],
  ['getToolTimeHeatmap', (a) => a.getToolTimeHeatmap('p', 30)],
  ['getErrorHotspots', (a) => a.getErrorHotspots('p', 30, 2)],
  ['getErrorClusters', (a) => a.getErrorClusters('p', 30, 2)],
  ['snapshots.list', (a) => a.snapshots.list()],
  ['snapshots.createFromSession', (a) => a.snapshots.createFromSession('p', 's')],
  ['snapshots.delete', (a) => a.snapshots.delete('id')],
  ['snapshots.open', (a) => a.snapshots.open('id')],
  // W11: ssh slice data methods + flat system methods.
  ['ssh.connect', (a) => a.ssh.connect({})],
  ['ssh.disconnect', (a) => a.ssh.disconnect()],
  ['ssh.getState', (a) => a.ssh.getState()],
  ['ssh.test', (a) => a.ssh.test({})],
  ['ssh.getConfigHosts', (a) => a.ssh.getConfigHosts()],
  ['ssh.resolveHost', (a) => a.ssh.resolveHost('h')],
  ['ssh.saveLastConnection', (a) => a.ssh.saveLastConnection({})],
  ['ssh.getLastConnection', (a) => a.ssh.getLastConnection()],
  ['getAppVersion', (a) => a.getAppVersion()],
  ['openPath', (a) => a.openPath('/x')],
  ['getAllTodos', (a) => a.getAllTodos([])],
  // W12: config slice (ConfigService-backed) + flat FilesService methods.
  ['config.get', (a) => a.config.get()],
  ['config.update', (a) => a.config.update('general', {})],
  ['config.addIgnoreRegex', (a) => a.config.addIgnoreRegex('p')],
  ['config.removeIgnoreRegex', (a) => a.config.removeIgnoreRegex('p')],
  ['config.addIgnoreRepository', (a) => a.config.addIgnoreRepository('r')],
  ['config.removeIgnoreRepository', (a) => a.config.removeIgnoreRepository('r')],
  ['config.snooze', (a) => a.config.snooze(30)],
  ['config.clearSnooze', (a) => a.config.clearSnooze()],
  ['config.addTrigger', (a) => a.config.addTrigger({})],
  ['config.updateTrigger', (a) => a.config.updateTrigger('t', {})],
  ['config.removeTrigger', (a) => a.config.removeTrigger('t')],
  ['config.getTriggers', (a) => a.config.getTriggers()],
  ['config.pinSession', (a) => a.config.pinSession('p', 's')],
  ['config.unpinSession', (a) => a.config.unpinSession('p', 's')],
  ['config.hideSession', (a) => a.config.hideSession('p', 's')],
  ['config.unhideSession', (a) => a.config.unhideSession('p', 's')],
  ['config.hideSessions', (a) => a.config.hideSessions('p', [])],
  ['config.unhideSessions', (a) => a.config.unhideSessions('p', [])],
  ['config.getClaudeRootInfo', (a) => a.config.getClaudeRootInfo()],
  ['config.openInEditor', (a) => a.config.openInEditor()],
  ['config.addBookmark', (a) => a.config.addBookmark('s', 'p', 'g')],
  ['config.removeBookmark', (a) => a.config.removeBookmark('b')],
  ['config.getBookmarks', (a) => a.config.getBookmarks()],
  ['config.addAnnotation', (a) => a.config.addAnnotation({})],
  ['config.updateAnnotation', (a) => a.config.updateAnnotation('id', {})],
  ['config.removeAnnotation', (a) => a.config.removeAnnotation('id')],
  ['config.getAnnotations', (a) => a.config.getAnnotations()],
  ['config.setSessionTags', (a) => a.config.setSessionTags('s', [])],
  ['config.getSessionTags', (a) => a.config.getSessionTags('s')],
  ['config.createGroup', (a) => a.config.createGroup('n')],
  ['config.deleteGroup', (a) => a.config.deleteGroup('n')],
  ['config.addToGroup', (a) => a.config.addToGroup('n', 's')],
  ['config.removeFromGroup', (a) => a.config.removeFromGroup('n', 's')],
  ['config.getGroups', (a) => a.config.getGroups()],
  ['config.addFilterPreset', (a) => a.config.addFilterPreset('n', {})],
  ['config.removeFilterPreset', (a) => a.config.removeFilterPreset('id')],
  ['config.renameFilterPreset', (a) => a.config.renameFilterPreset('id', 'n')],
  ['config.setDefaultFilterPreset', (a) => a.config.setDefaultFilterPreset('id')],
  ['config.exportAnnotations', (a) => a.config.exportAnnotations([])],
  ['config.importAnnotations', (a) => a.config.importAnnotations('{}')],
  ['config.getDismissedSuggestions', (a) => a.config.getDismissedSuggestions()],
  ['config.dismissSuggestion', (a) => a.config.dismissSuggestion('r')],
  ['validatePath', (a) => a.validatePath('r', 'p')],
  ['validateMentions', (a) => a.validateMentions([], 'p')],
  ['readClaudeMdFiles', (a) => a.readClaudeMdFiles('r')],
  ['readDirectoryClaudeMd', (a) => a.readDirectoryClaudeMd('d')],
  ['readMentionedFile', (a) => a.readMentionedFile('a', 'r')],
  ['readAgentConfigs', (a) => a.readAgentConfigs('r')],
  ['readGlobalPlugins', (a) => a.readGlobalPlugins()],
  ['readGlobalSettings', (a) => a.readGlobalSettings()],
  ['updateGlobalSettings', (a) => a.updateGlobalSettings({})],
  ['readHooks', (a) => a.readHooks()],
  ['toggleHook', (a) => a.toggleHook('e', 0, 'f', true)],
  ['setPluginEnabled', (a) => a.setPluginEnabled('k', true)],
  ['dedupePlugin', (a) => a.dedupePlugin('n', 'k')],
  ['detectPluginDuplicates', (a) => a.detectPluginDuplicates()],
  ['enumerateSettingsSources', (a) => a.enumerateSettingsSources('r')],
  ['readClaudeJSON', (a) => a.readClaudeJSON()],
  ['revealClaudeJSONValue', (a) => a.revealClaudeJSONValue('k')],
  ['readClaudeJSONMasked', (a) => a.readClaudeJSONMasked()],
  ['listClaudeJSONBackups', (a) => a.listClaudeJSONBackups()],
  ['readClaudeJSONBackup', (a) => a.readClaudeJSONBackup('n')],
  ['purgeClaudeJSONProjects', (a) => a.purgeClaudeJSONProjects([])],
  ['listClaudeJSONAppBackups', (a) => a.listClaudeJSONAppBackups()],
  ['restoreClaudeJSONAppBackup', (a) => a.restoreClaudeJSONAppBackup('n')],
  ['getMCPStatus', (a) => a.getMCPStatus()],
  ['getPermissionRules', (a) => a.getPermissionRules('r')],
  ['addPermissionRule', (a) => a.addPermissionRule('global', 'allow', 'r')],
  ['removePermissionRule', (a) => a.removePermissionRule('global', 'allow', 'r')],
  ['movePermissionRule', (a) => a.movePermissionRule('global', 'projectLocal', 'allow', 'allow', 'r')],
  ['analyzePermissionSuggestions', (a) => a.analyzePermissionSuggestions('r')],
  // W13: maintenance slice data methods (41). Config-backup methods stay notPorted (W14).
  ['maintenance.scanClaudeDir', (a) => a.maintenance.scanClaudeDir()],
  ['maintenance.cancelScan', (a) => a.maintenance.cancelScan()],
  ['maintenance.scanCategory', (a) => a.maintenance.scanCategory('id')],
  ['maintenance.getCutoff', (a) => a.maintenance.getCutoff('id')],
  ['maintenance.setCutoff', (a) => a.maintenance.setCutoff('id', 30)],
  ['maintenance.readPlanFile', (a) => a.maintenance.readPlanFile('n')],
  ['maintenance.trashItems', (a) => a.maintenance.trashItems([])],
  ['maintenance.listTrash', (a) => a.maintenance.listTrash()],
  ['maintenance.restoreTrash', (a) => a.maintenance.restoreTrash('id')],
  ['maintenance.emptyTrash', (a) => a.maintenance.emptyTrash([])],
  ['maintenance.rollbackBinary', (a) => a.maintenance.rollbackBinary('a', 'b')],
  ['maintenance.analyzeHistory', (a) => a.maintenance.analyzeHistory()],
  ['maintenance.pruneHistory', (a) => a.maintenance.pruneHistory(30)],
  ['maintenance.clearFiles', (a) => a.maintenance.clearFiles([], true)],
  ['maintenance.getMaintenanceHealth', (a) => a.maintenance.getMaintenanceHealth()],
  ['maintenance.getScheduleStatus', (a) => a.maintenance.getScheduleStatus()],
  ['maintenance.listSettingsGenerations', (a) => a.maintenance.listSettingsGenerations()],
  ['maintenance.readSettingsGeneration', (a) => a.maintenance.readSettingsGeneration('n')],
  ['maintenance.restoreSettingsGeneration', (a) => a.maintenance.restoreSettingsGeneration('n')],
  ['maintenance.listInstructionFiles', (a) => a.maintenance.listInstructionFiles()],
  ['maintenance.readInstructionFile', (a) => a.maintenance.readInstructionFile('r')],
  ['maintenance.writeInstructionFile', (a) => a.maintenance.writeInstructionFile('r', 'c')],
  ['maintenance.deleteInstructionFile', (a) => a.maintenance.deleteInstructionFile('r')],
  ['maintenance.listManagedAgents', (a) => a.maintenance.listManagedAgents()],
  ['maintenance.patchAgentFrontmatter', (a) => a.maintenance.patchAgentFrontmatter('f', {})],
  ['maintenance.createAgent', (a) => a.maintenance.createAgent('n', 'd')],
  ['maintenance.deleteAgent', (a) => a.maintenance.deleteAgent('f')],
  ['maintenance.skillsInventory', (a) => a.maintenance.skillsInventory()],
  ['maintenance.readSkillDoc', (a) => a.maintenance.readSkillDoc('s')],
  ['maintenance.writeSkillDoc', (a) => a.maintenance.writeSkillDoc('s', 'c')],
  ['maintenance.removeSkillLink', (a) => a.maintenance.removeSkillLink('s')],
  ['maintenance.deleteSkill', (a) => a.maintenance.deleteSkill('s')],
  ['maintenance.listMemoryDirs', (a) => a.maintenance.listMemoryDirs()],
  ['maintenance.memoryIntegrity', (a) => a.maintenance.memoryIntegrity('d')],
  ['maintenance.readMemoryFile', (a) => a.maintenance.readMemoryFile('d', 'f')],
  ['maintenance.writeMemoryFile', (a) => a.maintenance.writeMemoryFile('d', 'f', 'c')],
  ['maintenance.applyMemoryIndexFix', (a) => a.maintenance.applyMemoryIndexFix('d', {})],
  ['maintenance.deleteMemoryFile', (a) => a.maintenance.deleteMemoryFile('d', 'f')],
  ['maintenance.previewPolicyClean', (a) => a.maintenance.previewPolicyClean()],
  ['maintenance.runPolicyClean', (a) => a.maintenance.runPolicyClean()],
  ['maintenance.cancelPolicyClean', (a) => a.maintenance.cancelPolicyClean()],
  // W14: notifications + webhook data methods, config.testTrigger, and the 7
  // maintenance config-backup methods.
  ['notifications.get', (a) => a.notifications.get()],
  ['notifications.markRead', (a) => a.notifications.markRead('id')],
  ['notifications.markAllRead', (a) => a.notifications.markAllRead()],
  ['notifications.delete', (a) => a.notifications.delete('id')],
  ['notifications.clear', (a) => a.notifications.clear()],
  ['notifications.getUnreadCount', (a) => a.notifications.getUnreadCount()],
  ['notifications.setNotificationPolicy', (a) => a.notifications.setNotificationPolicy(30, 100)],
  ['notifications.raiseConfigDrift', (a) => a.notifications.raiseConfigDrift('f', 0, 0)],
  ['config.testTrigger', (a) => a.config.testTrigger({})],
  ['webhook.testSend', (a) => a.webhook.testSend({})],
  ['maintenance.captureConfig', (a) => a.maintenance.captureConfig('l')],
  ['maintenance.listConfigBackups', (a) => a.maintenance.listConfigBackups()],
  ['maintenance.restoreConfig', (a) => a.maintenance.restoreConfig('id', [])],
  ['maintenance.deleteConfigBackup', (a) => a.maintenance.deleteConfigBackup('id')],
  ['maintenance.exportBackup', (a) => a.maintenance.exportBackup('id', false)],
  ['maintenance.validateImportDialog', (a) => a.maintenance.validateImportDialog()],
  ['maintenance.applyImport', (a) => a.maintenance.applyImport('p', [])],
];

let createTauriClient: () => any;
beforeAll(async () => {
  ({ createTauriClient } = await import('./tauriClient'));
});

test('every PORTED key resolves to a non-thrower (not the notPorted stub)', () => {
  const api = createTauriClient();
  const broken: string[] = [];
  for (const [name, call] of PORTED) {
    try {
      call(api);
    } catch (e) {
      if (NOT_PORTED.test(String((e as Error).message))) broken.push(name);
    }
  }
  expect(broken).toEqual([]);
});

test('an un-ported data method still throws notPorted (gate detects gaps)', () => {
  const api = createTauriClient();
  // getSessionMetrics is a flat WailsAPI method not yet wired — must still throw.
  expect(() => api.getSessionMetrics('p', 's')).toThrow(NOT_PORTED);
});

