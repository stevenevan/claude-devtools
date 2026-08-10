import { JSX, useMemo, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { ArrowDown, ArrowUp, EyeOff, RotateCcw, Settings2 } from 'lucide-react';

import { applyLayoutToRegistry, layoutReduce } from './widgetRegistry';

import type { DashboardLayoutState } from './widgetRegistry';

export const DashboardCustomizeMenu = (): JSX.Element => {
  const [open, setOpen] = useState(false);
  const appConfig = useStore((s) => s.appConfig);
  const updateDashboardLayout = useStore((s) => s.updateDashboardLayout);

  const layout: DashboardLayoutState = useMemo(
    () => ({
      widgetOrder: appConfig?.dashboard?.widgetOrder ?? [],
      hiddenWidgets: appConfig?.dashboard?.hiddenWidgets ?? [],
    }),
    [appConfig]
  );

  const { visible, hidden } = useMemo(() => applyLayoutToRegistry(layout), [layout]);
  const all = [...visible, ...hidden];
  const hiddenSet = new Set(layout.hiddenWidgets);

  const persist = async (next: DashboardLayoutState): Promise<void> => {
    await updateDashboardLayout({
      widgetOrder: next.widgetOrder,
      hiddenWidgets: next.hiddenWidgets,
    });
  };

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'text-text-secondary hover:bg-surface-raised rounded-sm px-2 py-1 text-[11px]',
          open && 'bg-surface-raised'
        )}
        title="Customize dashboard"
        aria-label="Customize dashboard"
      >
        <Settings2 className="size-3" />
        Customize
      </Button>

      {open && (
        <div className="bg-surface-overlay border-border/60 absolute right-0 z-20 mt-1 w-72 rounded-xs border p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-text text-[11px] font-medium">Widgets</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void persist(layoutReduce(layout, { type: 'reset' }))}
              className="text-text-muted hover:text-text h-5 gap-1 px-1 text-[10px]"
              title="Reset to defaults"
            >
              <RotateCcw className="size-2.5" />
              Reset
            </Button>
          </div>

          <ul className="flex flex-col gap-1">
            {all.map((widget, idx) => {
              const isHidden = hiddenSet.has(widget.id);
              return (
                <li
                  key={widget.id}
                  className="border-border/40 bg-background/40 flex items-center gap-2 rounded-sm border px-2 py-1 text-[10px]"
                >
                  <div className="min-w-0 flex-1">
                    <span className={cn('block truncate', isHidden && 'text-text-muted')}>
                      {widget.title}
                    </span>
                    {widget.description && (
                      <span className="text-text-muted block truncate text-[9px]">
                        {widget.description}
                      </span>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() =>
                      void persist(
                        layoutReduce(layout, { type: 'move', id: widget.id, direction: 'up' })
                      )
                    }
                    disabled={idx === 0 || isHidden}
                    className="text-text-muted hover:text-text disabled:opacity-30"
                    title="Move up"
                    aria-label={`Move ${widget.title} up`}
                  >
                    <ArrowUp className="size-2.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() =>
                      void persist(
                        layoutReduce(layout, { type: 'move', id: widget.id, direction: 'down' })
                      )
                    }
                    disabled={idx === all.length - 1 || isHidden}
                    className="text-text-muted hover:text-text disabled:opacity-30"
                    title="Move down"
                    aria-label={`Move ${widget.title} down`}
                  >
                    <ArrowDown className="size-2.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() =>
                      void persist(layoutReduce(layout, { type: 'toggle-hidden', id: widget.id }))
                    }
                    className={cn(
                      'rounded-sm p-0.5',
                      isHidden ? 'text-amber-400' : 'text-text-muted hover:text-text'
                    )}
                    title={isHidden ? 'Show widget' : 'Hide widget'}
                    aria-label={isHidden ? `Show ${widget.title}` : `Hide ${widget.title}`}
                  >
                    <EyeOff className="size-2.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
