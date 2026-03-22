import { useEffect } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { ExternalLink, Loader2, Shield, Sliders, Zap } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

// =============================================================================
// Section Components
// =============================================================================

interface BadgeListProps {
  items: string[];
  color: string;
}

const BadgeList = ({ items, color }: Readonly<BadgeListProps>): React.JSX.Element => (
  <div className="flex flex-wrap gap-1.5">
    {items.map((item) => (
      <span
        key={item}
        className="rounded-sm border border-border bg-surface-overlay px-2 py-0.5 font-mono text-[10px]"
        style={{ color }}
      >
        {item}
      </span>
    ))}
  </div>
);

interface SettingsSectionProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}

const SettingsSection = ({
  icon: Icon,
  title,
  children,
}: Readonly<SettingsSectionProps>): React.JSX.Element => (
  <div className="rounded-xs border border-border bg-surface p-4">
    <div className="mb-3 flex items-center gap-2">
      <Icon className="text-text-secondary size-4" />
      <h3 className="text-sm font-medium text-text">
        {title}
      </h3>
    </div>
    {children}
  </div>
);

// =============================================================================
// Global Settings View
// =============================================================================

export const GlobalSettingsView = (): React.JSX.Element | null => {
  const { globalSettings, globalSettingsLoading, globalSettingsError, fetchGlobalSettings } =
    useStore(
      useShallow((s) => ({
        globalSettings: s.globalSettings,
        globalSettingsLoading: s.globalSettingsLoading,
        globalSettingsError: s.globalSettingsError,
        fetchGlobalSettings: s.fetchGlobalSettings,
      }))
    );

  useEffect(() => {
    if (!globalSettings && !globalSettingsLoading) {
      void fetchGlobalSettings();
    }
  }, [globalSettings, globalSettingsLoading, fetchGlobalSettings]);

  if (globalSettingsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-center gap-3 text-text-muted">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">Loading settings...</span>
        </div>
      </div>
    );
  }

  if (globalSettingsError) {
    return (
      <div className="border-border flex flex-col items-center justify-center rounded-xs border border-dashed px-8 py-16">
        <p className="text-sm text-red-400">{globalSettingsError}</p>
      </div>
    );
  }

  if (!globalSettings) return null;

  const permissions = globalSettings.permissions as
    | { allow?: string[]; deny?: string[]; ask?: string[]; defaultMode?: string }
    | undefined;
  const enabledPlugins = globalSettings.enabledPlugins as Record<string, boolean> | undefined;
  const alwaysThinkingEnabled = globalSettings.alwaysThinkingEnabled as boolean | undefined;
  const autoUpdatesChannel = globalSettings.autoUpdatesChannel as string | undefined;

  const allowList = permissions?.allow ?? [];
  const denyList = permissions?.deny ?? [];
  const defaultMode = permissions?.defaultMode;

  const enabledPluginNames = enabledPlugins
    ? Object.entries(enabledPlugins)
        .filter(([, v]) => v)
        .map(([k]) => k)
    : [];

  return (
    <div className="space-y-3">
      {/* Open in editor */}
      <div className="flex justify-end">
        <button
          onClick={() => void api.openPath('~/.claude/settings.json')}
          className="text-text-muted hover:text-text-secondary flex items-center gap-1.5 text-xs transition-colors"
          title="Open settings.json in editor"
        >
          <ExternalLink className="size-3" />
          Open in Editor
        </button>
      </div>

      {/* Permissions */}
      <SettingsSection icon={Shield} title="Permissions">
        <div className="space-y-3">
          {defaultMode && (
            <div>
              <p className="text-text-muted mb-1 text-[10px] uppercase tracking-wider">
                Default Mode
              </p>
              <span className="rounded-sm border border-border px-2 py-0.5 text-xs text-text-secondary">
                {defaultMode}
              </span>
            </div>
          )}
          {allowList.length > 0 && (
            <div>
              <p className="text-text-muted mb-1.5 text-[10px] uppercase tracking-wider">Allow</p>
              <BadgeList items={allowList} color="var(--color-text-secondary)" />
            </div>
          )}
          {denyList.length > 0 && (
            <div>
              <p className="text-text-muted mb-1.5 text-[10px] uppercase tracking-wider">Deny</p>
              <BadgeList items={denyList} color="rgb(248,113,113)" />
            </div>
          )}
        </div>
      </SettingsSection>

      {/* Plugins */}
      {enabledPluginNames.length > 0 && (
        <SettingsSection icon={Zap} title="Enabled Plugins">
          <BadgeList items={enabledPluginNames} color="var(--color-text-secondary)" />
        </SettingsSection>
      )}

      {/* Feature Flags */}
      <SettingsSection icon={Sliders} title="Features">
        <div className="space-y-2">
          {alwaysThinkingEnabled !== undefined && (
            <div className="flex items-center justify-between">
              <span className="text-text-secondary text-xs">Always Thinking</span>
              <span
                className={`text-xs ${alwaysThinkingEnabled ? 'text-emerald-400' : 'text-zinc-500'}`}
              >
                {alwaysThinkingEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          )}
          {autoUpdatesChannel && (
            <div className="flex items-center justify-between">
              <span className="text-text-secondary text-xs">Auto Updates Channel</span>
              <span className="text-text-muted text-xs">{autoUpdatesChannel}</span>
            </div>
          )}
        </div>
      </SettingsSection>
    </div>
  );
};
