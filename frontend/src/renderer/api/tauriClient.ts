import { analyticsCommands } from './tauri/domain/analytics';
import { claudeFilesCommands } from './tauri/domain/claudeFiles';
import { codexExtensionsCommands } from './tauri/domain/codexExtensions';
import { codexSettingsCommands } from './tauri/domain/codexSettings';
import { codexInventoryCommands } from './tauri/domain/codexInventory';
import { configApi, notificationEvents, notificationsApi, webhookApi } from './tauri/domain/config';
import { filesCommands } from './tauri/domain/files';
import { insightsCommands } from './tauri/domain/insights';
import { inspectorCommands } from './tauri/domain/inspector';
import { maintenanceCommands, maintenanceEvents } from './tauri/domain/maintenance';
import { pluginsApi, sessionApi, sessionCommands } from './tauri/domain/session';
import { snapshotsCommands } from './tauri/domain/snapshots';
import { sshCommands } from './tauri/domain/ssh';
import { contextEvents, sshEvents, systemCommands, systemEvents } from './tauri/domain/system';
import { timingCommands } from './tauri/domain/timing';

import type { DesktopAPI } from '@shared/types/api';

export function createTauriClient(): DesktopAPI {
  return {
    ...systemEvents,
    ...sessionCommands, // flat session data methods (getSessionDetail, …) — W7
    ...analyticsCommands, // flat analytics data methods (getAnalytics, …) — W8
    ...timingCommands, // flat backend-observability methods (getBackendTimings, …) — W8
    ...insightsCommands, // flat insights data methods (getToolAnalytics, …) — W9
    ...systemCommands, // flat system data methods (getAppVersion, openPath, …) — W11
    ...filesCommands, // flat FilesService methods (validatePath, getMCPStatus, …) — W12
    ...claudeFilesCommands, // flat read-only ~/.claude viewer methods
    ...codexExtensionsCommands, // Codex plugin and MCP inventory
    ...codexSettingsCommands, // Codex settings discovery and safe editor
    ...codexInventoryCommands, // Codex instructions, agents, and skills inventory
    ...inspectorCommands, // source-aware Claude/Codex inspector methods
    ssh: { ...sshEvents, ...sshCommands },
    context: { ...systemCommands.context, ...contextEvents },
    maintenance: { ...maintenanceEvents, ...maintenanceCommands },
    notifications: { ...notificationEvents, ...notificationsApi },
    config: configApi,
    session: sessionApi,
    snapshots: snapshotsCommands,
    plugins: pluginsApi,
    webhook: webhookApi,
    windowControls: systemCommands.windowControls,
    updater: systemCommands.updater,
    httpServer: systemCommands.httpServer,
  };
}
