import { useEffect, useState } from 'react';

interface UseFileBackedEditorOptions {
  load: () => Promise<string>;
  save: (value: string) => Promise<void>;
  validate?: (value: string) => string | null;
}

interface UseFileBackedEditorResult {
  value: string;
  setValue: (value: string) => void;
  dirty: boolean;
  error: string | null;
  saving: boolean;
  loading: boolean;
  save: () => Promise<void>;
  discard: () => void;
  reload: () => Promise<void>;
}

// Shared load/edit/validate/save state machine every config editor (weeks
// 16-28) builds on. Callers supply the typed load/save/validate calls; this
// hook only owns dirty-state, error surface, and the load/save lifecycle.
export function useFileBackedEditor(
  opts: UseFileBackedEditorOptions
): UseFileBackedEditorResult {
  const [value, setValueState] = useState('');
  const [loadedValue, setLoadedValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await opts.load();
      setValueState(loaded);
      setLoadedValue(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // Load once on mount; load/save/validate are stable per editor instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setValue = (next: string): void => {
    setValueState(next);
    setError(opts.validate ? opts.validate(next) : null);
  };

  const save = async (): Promise<void> => {
    const validationError = opts.validate ? opts.validate(value) : null;
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await opts.save(value);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const discard = (): void => {
    setValueState(loadedValue);
    setError(null);
  };

  return {
    value,
    setValue,
    dirty: value !== loadedValue,
    error,
    saving,
    loading,
    save,
    discard,
    reload,
  };
}
