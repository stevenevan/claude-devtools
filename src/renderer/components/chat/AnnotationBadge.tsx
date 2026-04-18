import { useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { MessageSquarePlus, MessageSquareText } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { AnnotationEditor, getAnnotationColorHex } from './AnnotationEditor';

interface AnnotationBadgeProps {
  targetId: string;
}

export const AnnotationBadge = ({
  targetId,
}: Readonly<AnnotationBadgeProps>): React.JSX.Element | null => {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  const { annotations, sessionId, projectId, addAnnotation, updateAnnotation, removeAnnotation } =
    useStore(
      useShallow((s) => ({
        annotations: s.annotations.filter((a) => a.targetId === targetId),
        sessionId: s.selectedSessionId,
        projectId: s.selectedProjectId,
        addAnnotation: s.addAnnotation,
        updateAnnotation: s.updateAnnotation,
        removeAnnotation: s.removeAnnotation,
      }))
    );

  if (!sessionId || !projectId) return null;

  const count = annotations.length;
  const hasAnnotations = count > 0;

  const closeAll = (): void => {
    setEditingId(null);
    setAddingNew(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] transition-opacity',
              hasAnnotations
                ? 'bg-surface-raised text-foreground opacity-100'
                : 'text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100'
            )}
            title={hasAnnotations ? `${count} annotation${count > 1 ? 's' : ''}` : 'Add note'}
          >
            {hasAnnotations ? (
              <>
                <MessageSquareText
                  className="size-3"
                  style={{ color: getAnnotationColorHex(annotations[0].color) }}
                />
                <span className="font-medium">{count}</span>
              </>
            ) : (
              <MessageSquarePlus className="size-3.5" />
            )}
          </button>
        }
      />
      <PopoverContent className="w-80 p-2" align="end">
        <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
          {annotations.map((annotation) =>
            editingId === annotation.id ? (
              <AnnotationEditor
                key={annotation.id}
                initialText={annotation.text}
                initialColor={annotation.color}
                onSave={async (text, color) => {
                  await updateAnnotation(annotation.id, { text, color });
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
                onDelete={async () => {
                  await removeAnnotation(annotation.id);
                  setEditingId(null);
                }}
              />
            ) : (
              <button
                key={annotation.id}
                type="button"
                onClick={() => setEditingId(annotation.id)}
                className="bg-surface-raised hover:bg-surface-overlay flex w-full items-start gap-2 rounded-md p-2 text-left text-xs"
              >
                <span
                  className="mt-0.5 size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: getAnnotationColorHex(annotation.color) }}
                />
                <span className="text-foreground flex-1 break-words whitespace-pre-wrap">
                  {annotation.text}
                </span>
              </button>
            )
          )}

          {addingNew ? (
            <AnnotationEditor
              onSave={async (text, color) => {
                await addAnnotation({ sessionId, projectId, targetId, text, color });
                setAddingNew(false);
              }}
              onCancel={() => setAddingNew(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                closeAll();
                setAddingNew(true);
              }}
              className="border-border hover:bg-surface-raised text-muted-foreground hover:text-foreground w-full rounded-md border border-dashed px-2 py-1.5 text-xs"
            >
              + Add note
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
