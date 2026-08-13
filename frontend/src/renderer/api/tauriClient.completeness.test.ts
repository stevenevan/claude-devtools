import { beforeAll, expect, mock, test } from 'bun:test';

const invocations: Array<{ command: string; args?: Record<string, unknown> }> = [];
const openedUrls: string[] = [];

mock.module('@tauri-apps/api/event', () => ({
  listen: async () => () => {},
  emit: async () => {},
}));

mock.module('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    invocations.push({ command, args });
    return null;
  },
}));

mock.module('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: async () => {},
    maximize: async () => {},
    unmaximize: async () => {},
    close: async () => {},
    isMaximized: async () => false,
  }),
}));

mock.module('@tauri-apps/plugin-dialog', () => ({ open: async () => null }));
mock.module('@tauri-apps/plugin-opener', () => ({
  openUrl: async (url: URL) => openedUrls.push(url.toString()),
}));

// Complete DesktopAPI contract: every call must resolve through Tauri or preserve
// its documented local no-op behavior. This list is intentionally explicit.
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
  // Session/search parity.
  ['getProjects', (a) => a.getProjects()],
  ['getGlobalSessionsPaginated', (a) => a.getGlobalSessionsPaginated(null)],
  ['getSessions', (a) => a.getSessions('p')],
  ['getSessionsPaginated', (a) => a.getSessionsPaginated('p', null)],
  ['searchSessions', (a) => a.searchSessions('p', 'query')],
  ['searchAllProjects', (a) => a.searchAllProjects('query')],
  ['searchSessionsFiltered', (a) => a.searchSessionsFiltered({})],
  ['searchSessionContent', (a) => a.searchSessionContent('p', 's', 'query')],
  ['getSessionDetail', (a) => a.getSessionDetail('p', 's')],
  ['getSessionDetailIncremental', (a) => a.getSessionDetailIncremental('p', 's')],
  ['getSessionMetrics', (a) => a.getSessionMetrics('p', 's')],
  ['getWaterfallData', (a) => a.getWaterfallData('p', 's')],
  ['getSubagentDetail', (a) => a.getSubagentDetail('p', 's', 'a')],
  ['getSessionGroups', (a) => a.getSessionGroups('p', 's')],
  ['getSessionsByIds', (a) => a.getSessionsByIds('p', ['s'])],
  ['getRepositoryGroups', (a) => a.getRepositoryGroups()],
  ['getWorktreeSessions', (a) => a.getWorktreeSessions('w')],
  ['parseNLQuery', (a) => a.parseNLQuery('last week')],
  ['session.scrollToLine', (a) => a.session.scrollToLine('s', 1)],
  ['plugins.list', (a) => a.plugins.list()],
  // W8: flat analytics + backend-observability methods.
  ['getAnalytics', (a) => a.getAnalytics(30)],
  ['getSimpleCostSummary', (a) => a.getSimpleCostSummary()],
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
  ['config.selectFolders', (a) => a.config.selectFolders()],
  ['config.selectClaudeRootFolder', (a) => a.config.selectClaudeRootFolder()],
  ['config.findWslClaudeRoots', (a) => a.config.findWslClaudeRoots()],
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
  ['readStatusLine', (a) => a.readStatusLine()],
  ['updateStatusLine', (a) => a.updateStatusLine(null)],
  ['statStatusLineScript', (a) => a.statStatusLineScript('/x/y')],
  ['revealStatusLineScript', (a) => a.revealStatusLineScript('/x/y')],
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
  ['addMCPServer', (a) => a.addMCPServer('n', { command: 'x' })],
  ['updateMCPServer', (a) => a.updateMCPServer('n', { args: [] })],
  ['removeMCPServer', (a) => a.removeMCPServer('n')],
  ['getPermissionRules', (a) => a.getPermissionRules('r')],
  ['addPermissionRule', (a) => a.addPermissionRule('global', 'allow', 'r')],
  ['removePermissionRule', (a) => a.removePermissionRule('global', 'allow', 'r')],
  ['movePermissionRule', (a) => a.movePermissionRule('global', 'projectLocal', 'allow', 'allow', 'r')],
  ['analyzePermissionSuggestions', (a) => a.analyzePermissionSuggestions('r')],
  // read-only ~/.claude viewers (shell snapshots, usage/telemetry, file-history)
  ['listShellSnapshots', (a) => a.listShellSnapshots()],
  ['readShellSnapshot', (a) => a.readShellSnapshot('x')],
  ['readUsageStats', (a) => a.readUsageStats()],
  ['listTelemetryEvents', (a) => a.listTelemetryEvents()],
  ['readTelemetryEvent', (a) => a.readTelemetryEvent('x')],
  ['listFileHistory', (a) => a.listFileHistory()],
  ['readCheckpoint', (a) => a.readCheckpoint('u', 'h', 1)],
  ['exportCheckpoint', (a) => a.exportCheckpoint('u', 'h', 1)],
  ['resolveCheckpointOrigin', (a) => a.resolveCheckpointOrigin('u', 'h')],
  ['restoreCheckpoint', (a) => a.restoreCheckpoint('u', 'h', 1)],
  ['readHistoryPage', (a) => a.readHistoryPage(null, 50)],
  ['listTranscripts', (a) => a.listTranscripts()],
  ['readTranscript', (a) => a.readTranscript('x')],
  ['readMarketplaceCatalog', (a) => a.readMarketplaceCatalog()],
  ['listTaskGraphs', (a) => a.listTaskGraphs()],
  ['readTaskGraph', (a) => a.readTaskGraph('u')],
  ['getInspectorSources', (a) => a.getInspectorSources()],
  ['readSourceHistoryPage', (a) => a.readSourceHistoryPage('claude', null, 50)],
  ['listSourceTranscripts', (a) => a.listSourceTranscripts('claude', null, 50)],
  ['readSourceTranscript', (a) => a.readSourceTranscript('claude', 'x', null, 50)],
  ['readSourceSession', (a) => a.readSourceSession('claude', 'x', null, 50)],
  ['listSourceTaskGraphs', (a) => a.listSourceTaskGraphs('claude')],
  ['readSourceTaskGraph', (a) => a.readSourceTaskGraph('claude', 'u')],
  // W13: maintenance slice data methods (41). Config-backup methods stay notPorted (W14).
  ['maintenance.scanClaudeDir', (a) => a.maintenance.scanClaudeDir()],
  ['maintenance.cancelScan', (a) => a.maintenance.cancelScan()],
  ['maintenance.scanCategory', (a) => a.maintenance.scanCategory('id')],
  ['maintenance.previewSimpleCleanup', (a) => a.maintenance.previewSimpleCleanup()],
  ['maintenance.runSimpleCleanup', (a) => a.maintenance.runSimpleCleanup('token')],
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
  ['getZoomFactor', (a) => a.getZoomFactor()],
  ['openExternal', (a) => a.openExternal('https://example.com')],
  ['windowControls.minimize', (a) => a.windowControls.minimize()],
  ['windowControls.maximize', (a) => a.windowControls.maximize()],
  ['windowControls.close', (a) => a.windowControls.close()],
  ['windowControls.isMaximized', (a) => a.windowControls.isMaximized()],
  ['windowControls.relaunch', (a) => a.windowControls.relaunch()],
  ['updater.check', (a) => a.updater.check()],
  ['updater.download', (a) => a.updater.download()],
  ['updater.install', (a) => a.updater.install()],
  ['updater.onStatus', (a) => a.updater.onStatus(() => {})],
  ['context.list', (a) => a.context.list()],
  ['context.getActive', (a) => a.context.getActive()],
  ['context.switch', (a) => a.context.switch('local')],
  ['httpServer.start', (a) => a.httpServer.start()],
  ['httpServer.stop', (a) => a.httpServer.stop()],
  ['httpServer.getStatus', (a) => a.httpServer.getStatus()],
];

let createTauriClient: () => any;
beforeAll(async () => {
  ({ createTauriClient } = await import('./tauriClient'));
});

test('every DesktopAPI method resolves through Tauri', async () => {
  const api = createTauriClient();
  for (const [name, call] of PORTED) {
    await Promise.resolve(call(api));
    expect(name).toBeTruthy();
  }
});

test('session commands preserve command names and argument shapes', async () => {
  invocations.length = 0;
  const api = createTauriClient();
  await api.getGlobalSessionsPaginated('global-cursor', 25);
  await api.getSessionsPaginated('project', 'cursor', 50, { prefilterAll: false });
  await api.searchSessionContent('project', 'session', 'needle');
  await api.getSubagentDetail('project', 'session', 'agent');
  expect(invocations).toEqual([
    {
      command: 'get_global_sessions_paginated',
      args: { cursor: 'global-cursor', limit: 25 },
    },
    {
      command: 'get_sessions_paginated',
      args: {
        projectId: 'project',
        cursor: 'cursor',
        limit: 50,
        options: { prefilterAll: false },
      },
    },
    {
      command: 'search_session_content',
      args: {
        projectId: 'project',
        sessionId: 'session',
        query: 'needle',
        isRegex: false,
        caseSensitive: false,
        cursor: null,
        pageSize: null,
      },
    },
    {
      command: 'get_subagent_detail',
      args: { projectId: 'project', sessionId: 'session', subagentId: 'agent' },
    },
  ]);
});

test('MCP server write commands preserve command names and argument shapes', async () => {
  invocations.length = 0;
  const api = createTauriClient();
  await api.addMCPServer('n', { command: 'x' });
  await api.updateMCPServer('n', { args: [] });
  await api.removeMCPServer('n');
  expect(invocations).toEqual([
    { command: 'add_mcp_server', args: { name: 'n', config: { command: 'x' } } },
    { command: 'update_mcp_server', args: { name: 'n', patch: { args: [] } } },
    { command: 'remove_mcp_server', args: { name: 'n' } },
  ]);
});

test('external opener permits only credential-free HTTP URLs', async () => {
  openedUrls.length = 0;
  const api = createTauriClient();
  await expect(api.openExternal('https://example.com/docs')).resolves.toEqual({ success: true });
  await expect(api.openExternal('javascript:alert(1)')).resolves.toEqual({
    success: false,
    error: 'invalid external URL',
  });
  await expect(api.openExternal('https://user@example.com')).resolves.toEqual({
    success: false,
    error: 'invalid external URL',
  });
  expect(openedUrls).toEqual(['https://example.com/docs']);
});
