import { useState } from 'react';

export interface UseClipboardOptions {
  timeout?: number;
}

export interface UseClipboardReturnValue {
  copy: (value: string) => void;
  reset: () => void;
  error: Error | null;
  copied: boolean;
}

export function useClipboard(
  options: UseClipboardOptions = { timeout: 2000 }
): UseClipboardReturnValue {
  const [error, setError] = useState<Error | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyTimeout, setCopyTimeout] = useState<number | null>(null);

  const handleCopyResult = (value: boolean): void => {
    window.clearTimeout(copyTimeout!);
    setCopyTimeout(window.setTimeout(() => setCopied(false), options.timeout));
    setCopied(value);
  };

  const copy = (value: string): void => {
    if ('clipboard' in navigator) {
      navigator.clipboard
        .writeText(value)
        .then(() => handleCopyResult(true))
        .catch((err: unknown) => setError(err instanceof Error ? err : new Error(String(err))));
    } else {
      setError(new Error('useClipboard: navigator.clipboard is not supported'));
    }
  };

  const reset = (): void => {
    setCopied(false);
    setError(null);
    window.clearTimeout(copyTimeout!);
  };

  return { copy, reset, error, copied };
}
