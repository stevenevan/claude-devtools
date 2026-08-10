import { JSX, useEffect, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { useStore } from '@renderer/store';
import { Loader2 } from 'lucide-react';

import { useSettingsConfig, useSettingsHandlers } from './hooks';
import { SimpleSettings } from './SimpleSettings';
import { SettingsSearch } from './SettingsSearch';
import {
  AdvancedSection,
  ClaudeCodeSection,
  ConnectionSection,
  GeneralSection,
  KeyboardShortcutsSection,
  NotificationsSection,
  PluginsSettings,
  ThemeEditor,
  WorkspaceSection,
} from './sections';
import { type SettingsSection, SettingsTabContent, SettingsTabs } from './SettingsTabs';

export const SettingsView = (): JSX.Element | null => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [showAllSettings, setShowAllSettings] = useState(false);
  const [searchTarget, setSearchTarget] = useState<{
    section: SettingsSection;
    anchorId: string;
  } | null>(null);
  const mode = useUIMode();
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

  useEffect(() => {
    if (!searchTarget || searchTarget.section !== activeSection) return;

    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(searchTarget.anchorId);
      if (!target) return;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (target instanceof HTMLElement) {
        target.focus({ preventScroll: true });
      }
      setSearchTarget(null);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeSection, searchTarget]);

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

  const handleSettingsSearchNavigate = (section: SettingsSection, anchorId: string): void => {
    setSearchTarget({ section, anchorId });
    setActiveSection(section);
  };

  const settingsHeader = (
    <div className="mb-6">
      <h1 className="text-foreground text-lg font-medium">Settings</h1>
      <p className="text-muted-foreground text-sm">Manage your app preferences</p>
      {error && (
        <div className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
    </div>
  );

  if (mode === 'simple' && !showAllSettings) {
    return (
      <div className="bg-background flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl px-6 py-8">
          {settingsHeader}
          <SimpleSettings
            safeConfig={safeConfig}
            saving={saving}
            error={error}
            onGeneralToggle={handlers.handleGeneralToggle}
            onThemeChange={handlers.handleThemeChange}
            onDefaultTabChange={handlers.handleDefaultTabChange}
            onUIModeChange={handlers.handleUIModeChange}
            onNotificationToggle={handlers.handleNotificationToggle}
          />
          <div className="border-border/50 mt-8 border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setShowAllSettings(true)}
            >
              Show all settings
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background flex-1 overflow-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        {settingsHeader}
        {mode === 'nerd' && <SettingsSearch onNavigate={handleSettingsSearchNavigate} />}

        <SettingsTabs activeSection={activeSection} onSectionChange={setActiveSection}>
          <SettingsTabContent value="general" className="mt-4">
            <GeneralSection
              safeConfig={safeConfig}
              saving={saving}
              onGeneralToggle={handlers.handleGeneralToggle}
              onThemeChange={handlers.handleThemeChange}
              onUIModeChange={handlers.handleUIModeChange}
              onDisplayToggle={handlers.handleDisplayToggle}
              onCodeBlockThemeChange={handlers.handleCodeBlockThemeChange}
            />
          </SettingsTabContent>

          <SettingsTabContent value="connection" className="mt-4">
            <ConnectionSection />
          </SettingsTabContent>

          <SettingsTabContent value="workspace" className="mt-4">
            <WorkspaceSection />
          </SettingsTabContent>

          <SettingsTabContent value="claudeCode" className="mt-4">
            <ClaudeCodeSection />
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
              onSetNotificationPolicy={handlers.handleSetNotificationPolicy}
            />
          </SettingsTabContent>

          <SettingsTabContent value="shortcuts" className="mt-4">
            <KeyboardShortcutsSection />
          </SettingsTabContent>

          <SettingsTabContent value="themes" className="mt-4">
            <ThemeEditor />
          </SettingsTabContent>

          <SettingsTabContent value="plugins" className="mt-4">
            <PluginsSettings />
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
