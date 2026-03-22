/**
 * SettingsView - Main settings panel with all app configuration options.
 * Provides UI for managing notifications, display settings, and advanced options.
 */

import { useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { Loader2 } from 'lucide-react';

import { useSettingsConfig, useSettingsHandlers } from './hooks';
import {
  AdvancedSection,
  ConnectionSection,
  GeneralSection,
  NotificationsSection,
  WorkspaceSection,
} from './sections';
import { type SettingsSection, SettingsTabContent, SettingsTabs } from './SettingsTabs';

export const SettingsView = (): React.JSX.Element | null => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const pendingSettingsSection = useStore((s) => s.pendingSettingsSection);
  const clearPendingSettingsSection = useStore((s) => s.clearPendingSettingsSection);

  // Consume pending section during render (React-recommended pattern for adjusting state on prop change)
  const [prevPending, setPrevPending] = useState<string | null>(null);
  if (pendingSettingsSection !== prevPending) {
    setPrevPending(pendingSettingsSection);
    if (pendingSettingsSection) {
      setActiveSection(pendingSettingsSection as SettingsSection);
      clearPendingSettingsSection();
    }
  }

  const {
    config,
    safeConfig,
    loading,
    saving,
    error,
    setError,
    setSaving,
    setConfig,
    setOptimisticConfig,
    updateConfig,
    ignoredRepositoryItems,
    excludedRepositoryIds,
    isSnoozed,
  } = useSettingsConfig();

  const handlers = useSettingsHandlers({
    config,
    setSaving,
    setError,
    setConfig,
    setOptimisticConfig,
    updateConfig,
  });

  // Loading state
  if (loading) {
    return (
      <div className="bg-background flex flex-1 items-center justify-center">
        <div className="text-muted-foreground flex items-center gap-3">
          <Loader2 className="size-5 animate-spin" />
          <span>Loading settings...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !config) {
    return (
      <div className="bg-background flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-red-400">{error}</p>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="bg-background flex-1 overflow-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-foreground text-lg font-medium">Settings</h1>
          <p className="text-muted-foreground text-sm">Manage your app preferences</p>
          {error && (
            <div className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Tabs + Content */}
        <SettingsTabs activeSection={activeSection} onSectionChange={setActiveSection}>
          <SettingsTabContent value="general" className="mt-4">
            <GeneralSection
              safeConfig={safeConfig}
              saving={saving}
              onGeneralToggle={handlers.handleGeneralToggle}
              onThemeChange={handlers.handleThemeChange}
            />
          </SettingsTabContent>

          <SettingsTabContent value="connection" className="mt-4">
            <ConnectionSection />
          </SettingsTabContent>

          <SettingsTabContent value="workspace" className="mt-4">
            <WorkspaceSection />
          </SettingsTabContent>

          <SettingsTabContent value="notifications" className="mt-4">
            <NotificationsSection
              safeConfig={safeConfig}
              saving={saving}
              isSnoozed={isSnoozed}
              ignoredRepositoryItems={ignoredRepositoryItems}
              excludedRepositoryIds={excludedRepositoryIds}
              onNotificationToggle={handlers.handleNotificationToggle}
              onSnooze={handlers.handleSnooze}
              onClearSnooze={handlers.handleClearSnooze}
              onAddIgnoredRepository={handlers.handleAddIgnoredRepository}
              onRemoveIgnoredRepository={handlers.handleRemoveIgnoredRepository}
              onAddTrigger={handlers.handleAddTrigger}
              onUpdateTrigger={handlers.handleUpdateTrigger}
              onRemoveTrigger={handlers.handleRemoveTrigger}
            />
          </SettingsTabContent>

          <SettingsTabContent value="advanced" className="mt-4">
            <AdvancedSection
              saving={saving}
              onResetToDefaults={handlers.handleResetToDefaults}
              onExportConfig={handlers.handleExportConfig}
              onImportConfig={handlers.handleImportConfig}
              onOpenInEditor={handlers.handleOpenInEditor}
            />
          </SettingsTabContent>
        </SettingsTabs>
      </div>
    </div>
  );
};
