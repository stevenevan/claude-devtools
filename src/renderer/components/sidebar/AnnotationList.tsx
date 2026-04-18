import { useEffect, useMemo } from 'react';

import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { useStore } from '@renderer/store';
import { formatDistanceToNowStrict } from 'date-fns';
import { MessageSquareText, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { getAnnotationColorHex } from '../chat/AnnotationEditor';

import type { AnnotationEntry } from '@shared/types';

export const AnnotationList = (): React.JSX.Element => {
  const {
    annotations,
    annotationsLoading,
    fetchAnnotations,
    removeAnnotation,
    navigateToSession,
  } = useStore(
    useShallow((s) => ({
      annotations: s.annotations,
      annotationsLoading: s.annotationsLoading,
      fetchAnnotations: s.fetchAnnotations,
      removeAnnotation: s.removeAnnotation,
      navigateToSession: s.navigateToSession,
    }))
  );

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
      <div className="flex h-full flex-col items-center justify-center px-4 py-12">
        <MessageSquareText className="text-muted-foreground mb-2 size-6" />
        <p className="text-muted-foreground mb-1 text-xs">No annotations yet</p>
        <p className="text-muted-foreground text-[10px]">
          Click the note icon on any turn to add one
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-2 py-2">
      <div className="flex flex-col gap-1">
        {sorted.map((annotation) => (
          <AnnotationRow
            key={annotation.id}
            annotation={annotation}
            onNavigate={() => navigateToSession(annotation.projectId, annotation.sessionId)}
            onRemove={() => void removeAnnotation(annotation.id)}
          />
        ))}
      </div>
    </div>
  );
};

const AnnotationRow = ({
  annotation,
  onNavigate,
  onRemove,
}: Readonly<{
  annotation: AnnotationEntry;
  onNavigate: () => void;
  onRemove: () => void;
}>): React.JSX.Element => {
  const timeAgo = formatDistanceToNowStrict(new Date(annotation.updatedAt), { addSuffix: true });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onNavigate();
        }
      }}
      className={cn(
        'group bg-surface-raised hover:bg-surface-overlay flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 transition-colors'
      )}
    >
      <span
        className="mt-1 size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: getAnnotationColorHex(annotation.color) }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-foreground line-clamp-2 text-xs break-words whitespace-pre-wrap">
          {annotation.text}
        </div>
        <div className="text-muted-foreground mt-0.5 text-[10px]">{timeAgo}</div>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="text-muted-foreground hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100"
        title="Remove annotation"
      >
        <Trash2 className="size-3" />
      </Button>
    </div>
  );
};
