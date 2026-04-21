import { useMemo } from 'react';

import {
  SHORTCUT_CATEGORIES,
  SHORTCUT_DEFINITIONS,
  type ShortcutDefinition,
} from '@renderer/constants/shortcuts';

import { SettingsSectionHeader } from '../components';

export const KeyboardShortcutsSection = (): React.JSX.Element => {
  const grouped = useMemo(() => {
    const map = new Map<ShortcutDefinition['category'], ShortcutDefinition[]>();
    for (const category of SHORTCUT_CATEGORIES) {
      map.set(category, []);
    }
    for (const definition of SHORTCUT_DEFINITIONS) {
      map.get(definition.category)?.push(definition);
    }
    return map;
  }, []);

  return (
    <div>
      <SettingsSectionHeader title="Keyboard Shortcuts" />
      <p className="text-muted-foreground mb-4 text-sm">
        Reference of every built-in shortcut. Customization is coming soon — the underlying
        registry already lives in <code className="text-foreground font-mono">constants/shortcuts.ts</code>.
      </p>

      <div className="flex flex-col gap-5">
        {SHORTCUT_CATEGORIES.map((category) => {
          const entries = grouped.get(category) ?? [];
          if (entries.length === 0) return null;
          return (
            <div key={category}>
              <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
                {category}
              </div>
              <div className="border-border divide-border-subtle bg-background/50 divide-y rounded-xs border">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between px-3 py-2 text-xs"
                  >
                    <span className="text-foreground">{entry.label}</span>
                    <kbd className="border-border bg-card rounded-sm border px-1.5 py-0.5 font-mono text-[11px]">
                      {entry.defaultBinding}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
