import { useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { Trash2 } from 'lucide-react';

import { ANNOTATION_COLORS } from './annotationColors';

interface AnnotationEditorProps {
  initialText?: string;
  initialColor?: string;
  onSave: (text: string, color: string) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void | Promise<void>;
}

export const AnnotationEditor = ({
  initialText = '',
  initialColor = 'amber',
  onSave,
  onCancel,
  onDelete,
}: Readonly<AnnotationEditorProps>): React.JSX.Element => {
  const [text, setText] = useState(initialText);
  const [color, setColor] = useState(initialColor);
  const [saving, setSaving] = useState(false);

  const handleSave = async (): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSave(trimmed, color);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a note…"
        autoFocus
        rows={3}
        className="border-border bg-surface-raised text-foreground focus:border-border-emphasis w-full resize-y rounded-md border px-2 py-1.5 text-xs outline-hidden"
      />
      <div className="flex items-center gap-1.5">
        {ANNOTATION_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-label={c.label}
            onClick={() => setColor(c.id)}
            className={cn(
              'size-4 rounded-full ring-offset-1 transition-all',
              color === c.id ? 'ring-foreground ring-2' : 'opacity-70 hover:opacity-100'
            )}
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <div>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onDelete}
              className="text-muted-foreground hover:text-red-400"
              title="Delete annotation"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving || text.trim().length === 0}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
};
