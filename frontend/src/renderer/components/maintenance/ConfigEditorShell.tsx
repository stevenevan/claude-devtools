import { JSX, ReactNode } from 'react';
import { Button } from '@renderer/components/ui/button';
import { Loader2 } from 'lucide-react';

interface ConfigEditorShellProps {
  title: string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onDiscard: () => void;
  children: ReactNode;
  canAct: boolean;
}

// Layout chrome shared by every config editor (weeks 16-28): title + dirty
// badge, error banner, arbitrary editor body, Save/Discard footer.
export const ConfigEditorShell = ({
  title,
  dirty,
  saving,
  error,
  onSave,
  onDiscard,
  children,
  canAct,
}: Readonly<ConfigEditorShellProps>): JSX.Element => {
  return (
    <div className="flex flex-col">
      <div className="border-border/50 flex items-center gap-2 border-b px-4 py-3">
        <p className="text-foreground text-sm font-medium">{title}</p>
        {dirty && (
          <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
            Unsaved changes
          </span>
        )}
      </div>

      {error && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}

      <div className="flex-1">{children}</div>

      <div className="border-border/50 flex items-center justify-end gap-2 border-t px-4 py-3">
        <Button variant="outline" size="sm" disabled={!dirty} onClick={onDiscard}>
          Discard
        </Button>
        <Button variant="default" size="sm" disabled={!dirty || saving || !canAct} onClick={onSave}>
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
};
