import { useCallback, useEffect, useRef, useState } from 'react';

import { useStore } from '@renderer/store';
import { Tag, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

interface SessionTagEditorProps {
  sessionId: string;
}

/**
 * SessionTagEditor - Inline tag editor for sessions.
 * Shows existing tags with an input to add new ones.
 */
export const SessionTagEditor = ({
  sessionId,
}: Readonly<SessionTagEditorProps>): React.JSX.Element => {
  const { tags, fetchSessionTags, setSessionTags } = useStore(
    useShallow((s) => ({
      tags: s.sessionTags.get(sessionId) ?? [],
      fetchSessionTags: s.fetchSessionTags,
      setSessionTags: s.setSessionTags,
    }))
  );

  const [inputValue, setInputValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchSessionTags(sessionId);
  }, [sessionId, fetchSessionTags]);

  const addTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim().toLowerCase();
      if (!trimmed || tags.includes(trimmed)) return;
      void setSessionTags(sessionId, [...tags, trimmed]);
      setInputValue('');
    },
    [sessionId, tags, setSessionTags]
  );

  const removeTag = useCallback(
    (tag: string) => {
      void setSessionTags(
        sessionId,
        tags.filter((t) => t !== tag)
      );
    },
    [sessionId, tags, setSessionTags]
  );

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setInputValue('');
    }
  };

  if (!isEditing && tags.length === 0) {
    return (
      <button
        onClick={() => {
          setIsEditing(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[10px] transition-colors"
      >
        <Tag className="size-2.5" />
        Add tags
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="border-border bg-surface-raised inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px]"
        >
          <span className="text-text-secondary">{tag}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              removeTag(tag);
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-2" />
          </button>
        </span>
      ))}
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (inputValue.trim()) addTag(inputValue);
            setIsEditing(false);
          }}
          placeholder="tag..."
          className="text-foreground placeholder:text-muted-foreground w-16 bg-transparent text-[10px] outline-hidden"
          autoFocus
        />
      ) : (
        <button
          onClick={() => {
            setIsEditing(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="text-muted-foreground hover:text-foreground text-[10px]"
        >
          +
        </button>
      )}
    </div>
  );
};
