import { AddTriggerForm } from './components/AddTriggerForm';
import { SettingsSectionHeader as SectionHeader } from '@renderer/components/settings/components/SettingsSectionHeader';
import { TriggerCard } from './components/TriggerCard';

import type { NotificationTriggerSettingsProps } from './types';

// Stable no-op function for builtin triggers that can't be removed
const noopRemove = (_triggerId: string): Promise<void> => Promise.resolve();

export const NotificationTriggerSettings = ({
  triggers,
  saving,
  onUpdateTrigger,
  onAddTrigger,
  onRemoveTrigger,
}: Readonly<NotificationTriggerSettingsProps>): React.JSX.Element => {
  const builtinTriggers = triggers.filter((t) => t.isBuiltin);
  const customTriggers = triggers.filter((t) => !t.isBuiltin);

  return (
    <div className="space-y-8">
      {builtinTriggers.length > 0 && (
        <div>
          <SectionHeader title="Built-in Triggers" />
          <p className="text-muted-foreground mb-4 text-xs">
            Default triggers that come with the application. You can enable/disable them and
            customize their patterns.
          </p>
          <div>
            {builtinTriggers.map((trigger) => (
              <TriggerCard
                key={trigger.id}
                trigger={trigger}
                saving={saving}
                onUpdate={onUpdateTrigger}
                onRemove={noopRemove}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionHeader title="Custom Triggers" />
        <p className="text-muted-foreground mb-4 text-xs">
          Create your own triggers to get notified for specific patterns or tool outputs.
        </p>

        {customTriggers.length > 0 && (
          <div className="mb-4">
            {customTriggers.map((trigger) => (
              <TriggerCard
                key={trigger.id}
                trigger={trigger}
                saving={saving}
                onUpdate={onUpdateTrigger}
                onRemove={onRemoveTrigger}
              />
            ))}
          </div>
        )}

        {customTriggers.length === 0 && (
          <p className="text-muted-foreground mb-4 text-sm italic">
            No custom triggers configured yet.
          </p>
        )}

        <AddTriggerForm saving={saving} onAdd={onAddTrigger} />
      </div>
    </div>
  );
};
