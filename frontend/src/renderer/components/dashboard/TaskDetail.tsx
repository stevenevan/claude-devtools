import { JSX, useEffect, useRef, useState } from 'react';

import { AnnotationEditor } from '@renderer/components/chat/AnnotationEditor';
import { Button } from '@renderer/components/ui/button';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { useStore } from '@renderer/store';
import { sanitizeSimpleText } from '@renderer/utils/simpleTextSanitizer';
import { Link2, Plus, Undo2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { annotationsForTask, taskAnnotationTargetId } from './taskAnnotations';

import type { AnnotationEntry } from '@shared/types';
import type { TodoItem } from '@renderer/types/todos';

export interface TaskDetailTask {
  projectId: string;
  sessionId: string;
  content: string;
  status: TodoItem['status'];
}

interface TaskDetailProps {
  task: TaskDetailTask;
  sessionTasks: TaskDetailTask[];
  onOpenConversation: (projectId: string, sessionId: string) => void;
  onClose: () => void;
}

function statusLabel(status: TodoItem['status']): string {
  if (status === 'in_progress') return 'Happening now';
  if (status === 'pending') return 'Waiting';
  return 'Done';
}

export const TaskDetail = ({
  task,
  sessionTasks,
  onOpenConversation,
  onClose,
}: Readonly<TaskDetailProps>): JSX.Element => {
  const mode = useUIMode();
  const notesLabel = mode === 'simple' ? 'Your notes' : 'Annotations';
  const { annotations, annotationsLoading, fetchAnnotations, addAnnotation, removeAnnotation } =
    useStore(
      useShallow((s) => ({
        annotations: s.annotations,
        annotationsLoading: s.annotationsLoading,
        fetchAnnotations: s.fetchAnnotations,
        addAnnotation: s.addAnnotation,
        removeAnnotation: s.removeAnnotation,
      }))
    );
  const [adding, setAdding] = useState(false);
  const [undone, setUndone] = useState<AnnotationEntry | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (annotations.length === 0 && !annotationsLoading) {
      void fetchAnnotations();
    }
  }, [annotations.length, annotationsLoading, fetchAnnotations]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const linked = annotationsForTask(annotations, task);
  const siblings = sessionTasks.filter(
    (entry) => entry.content !== task.content || entry.status !== task.status
  );
  const displayContent = task.content || 'Unnamed task';

  const handleAddNote = async (text: string, color: string): Promise<void> => {
    const entry = await addAnnotation({
      sessionId: task.sessionId,
      projectId: task.projectId,
      targetId: taskAnnotationTargetId(task),
      text,
      color,
    });
    if (entry) {
      setAdding(false);
      setUndone(null);
    }
  };

  const handleDetach = async (entry: AnnotationEntry): Promise<void> => {
    setUndone(entry);
    await removeAnnotation(entry.id);
  };

  const handleUndoDetach = async (): Promise<void> => {
    if (!undone) return;
    await addAnnotation({
      sessionId: undone.sessionId,
      projectId: undone.projectId,
      targetId: undone.targetId,
      text: undone.text,
      color: undone.color,
    });
    setUndone(null);
  };

  return (
    <section
      aria-label={`Details for ${displayContent}`}
      className="border-border/60 bg-card/30 ml-7 rounded-md border px-4 py-3"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 ref={headingRef} tabIndex={-1} className="text-foreground text-sm font-semibold outline-hidden">
          {displayContent}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label={`Close details for ${displayContent}`}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {statusLabel(task.status)} ·{' '}
        <Button
          type="button"
          variant="link"
          onClick={() => onOpenConversation(task.projectId, task.sessionId)}
          className="h-auto px-0 py-0 text-xs"
        >
          Open conversation
        </Button>
      </p>

      {siblings.length > 0 && (
        <div className="mt-3">
          <h4 className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
            In the same conversation
          </h4>
          <ul className="mt-1 space-y-1">
            {siblings.map((sibling) => (
              <li key={`${sibling.status}:${sibling.content}`} className="text-xs">
                <Button
                  type="button"
                  variant="link"
                  onClick={() => onOpenConversation(sibling.projectId, sibling.sessionId)}
                  className="text-muted-foreground hover:text-foreground h-auto justify-start px-0 py-0 text-left text-xs font-normal"
                >
                  {statusLabel(sibling.status)}: {sanitizeSimpleText(sibling.content) || 'Unnamed task'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase">
            <Link2 className="size-3" aria-hidden="true" />
            {notesLabel} ({linked.length})
          </h4>
          {!adding && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => {
                setAdding(true);
                setUndone(null);
              }}
              className="gap-1 text-xs"
            >
              <Plus className="size-3" aria-hidden="true" />
              Add note
            </Button>
          )}
        </div>
        {linked.length === 0 && !adding && (
          <p className="text-muted-foreground mt-1 text-xs">
            No notes on this task yet.
          </p>
        )}
        <ul className="mt-1 space-y-1.5">
          {linked.map((entry) => (
            <li
              key={entry.id}
              className="text-foreground flex items-start justify-between gap-2 text-xs"
            >
              <span className="min-w-0 flex-1 break-words">{entry.text}</span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => void handleDetach(entry)}
                aria-label={`Detach note: ${entry.text}`}
                className="text-muted-foreground hover:text-destructive shrink-0"
              >
                Detach
              </Button>
            </li>
          ))}
        </ul>
        {undone && (
          <div role="status" className="mt-2 flex items-center justify-between gap-2 rounded-sm bg-muted px-2 py-1.5 text-xs">
            <span className="text-muted-foreground">Note detached.</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void handleUndoDetach()}
              className="gap-1"
            >
              <Undo2 className="size-3" aria-hidden="true" />
              Undo
            </Button>
          </div>
        )}
        {adding && (
          <div className="mt-2">
            <AnnotationEditor
              onSave={handleAddNote}
              onCancel={() => setAdding(false)}
            />
          </div>
        )}
      </div>
    </section>
  );
};
