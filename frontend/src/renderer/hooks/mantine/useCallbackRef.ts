import { useEffect, useMemo, useRef } from 'react';

// Generic over any callable so consumers can pass arbitrary signatures.
// oxlint-disable-next-line typescript-eslint/no-explicit-any -- mantine-derived hook; generic must accept any callable
export function useCallbackRef<T extends (...args: any[]) => any>(callback: T | undefined): T {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  });

  // oxlint-disable-next-line typescript-eslint/no-unsafe-return, typescript-eslint/no-unsafe-argument -- generic spread into any-typed callback
  return useMemo(() => ((...args) => callbackRef.current?.(...args)) as T, []);
}
