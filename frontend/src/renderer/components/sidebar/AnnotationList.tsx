import { JSX, useEffect, useMemo } from 'react';
import { Button } from '@renderer/components/ui/button';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { useConversationSubjects, conversationSubjectKey } from '@renderer/hooks/useConversationSubjects';
import { useUIMode } from '@renderer/hooks/useUIMode';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { formatDistanceToNowStrict } from 'date-fns';
import { MessageSquareText, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { getAnnotationColorHex } from '../chat/annotationColors';
import { CollectionsPanel } from '../chat/CollectionsPanel';

import type { AnnotationEntry } from '@shared/types';

export const AnnotationList = (): JSX.Element => {
  const {
    annotations,
    annotationsLoading,
    annotationsError,
    fetchAnnotations,
    removeAnnotation,
    navigateToSession,
  } = useStore(
    useShallow((s) => ({
      annotations: s.annotations,
      annotationsLoading: s.annotationsLoading,
      annotationsError: s.annotationsError,
      fetchAnnotations: s.fetchAnnotations,
      removeAnnotation: s.removeAnnotation,
      navigateToSession: s.navigateToSession,
    }))
  );
  const mode = useUIMode();

  const conversationIdentities = useMemo(
    () => annotations.map(({ projectId, sessionId }) => ({ projectId, sessionId })),
    [annotations]
  );
  const conversationSubjects = useConversationSubjects(conversationIdentities);

  useEffect(() => {
    void fetchAnnotations();
  }, [fetchAnnotations]);

  const sorted = useMemo(
    () => [...annotations].sort((a, b) => b.updatedAt - a.updatedAt),
    [annotations]
  );

  if (annotationsLoading && annotations.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 py-12">
        <p className="text-muted-foreground text-xs">Loading annotations…</p>
      </div>
    );
  }

  if (annotations.length === 0) {
    return (
      <div className="flex h-full flex-col gap-3 overflow-y-auto px-2 py-2">
        <CollectionsPanel />
        <AnnotationError message={annotationsError} />
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
          <MessageSquareText className="text-muted-foreground mb-2 size-6" />
          <p className="text-muted-foreground mb-1 text-xs">No annotations yet</p>
          <p className="text-muted-foreground max-w-xs text-center text-[10px]">
            While reading a conversation, add a note to remember something about it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto px-2 py-2">
      <CollectionsPanel />
      <AnnotationError message={annotationsError} />
      <ul className="flex list-none flex-col gap-1 p-0">
        {sorted.map((annotation) => (
          <AnnotationRow
            key={annotation.id}
            annotation={annotation}
            mode={mode}
            subject={
              conversationSubjects.get(
                conversationSubjectKey({
                  projectId: annotation.projectId,
                  sessionId: annotation.sessionId,
                })
              ) ?? 'Untitled conversation'
            }
            onNavigate={() => navigateToSession(annotation.projectId, annotation.sessionId)}
            onRemove={() => removeAnnotation(annotation.id)}
          />
        ))}
      </ul>
    </div>
  );
};

const AnnotationError = ({ message }: Readonly<{ message: string | null }>): JSX.Element | null => {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs"
    >
      Could not load or update annotations: {message}. Try the action again.
    </div>
  );
};

const AnnotationRow = ({
  annotation,
  mode,
  subject,
  onNavigate,
  onRemove,
}: Readonly<{
  annotation: AnnotationEntry;
  mode: 'simple' | 'nerd';
  subject: string;
  onNavigate: () => void;
  onRemove: () => Promise<void>;
}>): JSX.Element => {
  const timeLabel =
    mode === 'simple'
      ? formatDistanceToNowStrict(new Date(annotation.updatedAt), { addSuffix: true })
      : new Date(annotation.updatedAt).toLocaleString();

  const handleRemove = async (): Promise<void> => {
    const confirmed = await confirm({
      title: mode === 'simple' ? 'Delete note?' : 'Remove annotation?',
      message:
        mode === 'simple'
          ? `Delete this note from ${subject}?`
          : `Remove this annotation from ${subject}?`,
      confirmLabel: mode === 'simple' ? 'Delete' : 'Remove',
      cancelLabel: 'Cancel',
      variant: 'danger',
    });
    if (confirmed) await onRemove();
  };

  return (
    <li
      className={cn(
        'group bg-surface-raised hover:bg-surface-overlay flex items-start gap-2 rounded-md px-2.5 py-2 transition-colors',
        mode === 'simple' ? 'gap-2.5' : 'gap-2'
      )}
    >
      <span
        className="mt-1.5 size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: getAnnotationColorHex(annotation.color) }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-foreground text-xs leading-relaxed break-words whitespace-pre-wrap">
          {annotation.text}
        </div>
        <div className="text-muted-foreground mt-1 text-[10px]">
          {mode === 'simple' ? `on ${subject}` : `${subject} · Session ${annotation.sessionId}`}
          {' · '}
          {timeLabel}
        </div>
        <div className={cn('mt-2 flex items-center gap-2', mode === 'nerd' && 'mt-1')}>
          <Button
            variant={mode === 'simple' ? 'secondary' : 'ghost'}
            size={mode === 'simple' ? 'sm' : 'xs'}
            onClick={onNavigate}
            className="gap-1"
          >
            <MessageSquareText className="size-3" />
            Open conversation
          </Button>
          <Button
            variant="ghost"
            size={mode === 'simple' ? 'sm' : 'icon-xs'}
            onClick={(event) => {
              event.stopPropagation();
              void handleRemove();
            }}
            className={cn(
              'text-muted-foreground hover:text-destructive',
              mode === 'nerd' && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
            )}
            aria-label={`Delete note: ${annotation.text}`}
            title={mode === 'nerd' ? 'Remove annotation' : undefined}
          >
            {mode === 'simple' ? 'Delete' : <Trash2 className="size-3" />}
          </Button>
        </div>
      </div>
    </li>
  );
};
