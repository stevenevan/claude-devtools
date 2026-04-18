import { useEffect, useMemo, useRef } from 'react';

import { useCallbackRef } from './useCallbackRef';

export interface UseDebouncedCallbackOptions {
  delay: number;
  flushOnUnmount?: boolean;
  leading?: boolean;
}

// Generic over any callable so consumers can pass arbitrary signatures.
// oxlint-disable-next-line typescript-eslint/no-explicit-any -- mantine-derived hook; generic must accept any callable
export type UseDebouncedCallbackReturnValue<T extends (...args: any[]) => any> = ((
  ...args: Parameters<T>
) => void) & { flush: () => void; cancel: () => void };

// oxlint-disable-next-line typescript-eslint/no-explicit-any -- mantine-derived hook; generic must accept any callable
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  options: number | UseDebouncedCallbackOptions
) {
  const { delay, flushOnUnmount, leading } =
    typeof options === 'number'
      ? { delay: options, flushOnUnmount: false, leading: false }
      : options;

  const handleCallback = useCallbackRef(callback);
  const debounceTimerRef = useRef(0);

  const lastCallback = useMemo(() => {
    const currentCallback = Object.assign(
      (...args: Parameters<T>) => {
        window.clearTimeout(debounceTimerRef.current);

        const isFirstCall = currentCallback._isFirstCall;
        currentCallback._isFirstCall = false;

        function clearTimeoutAndLeadingRef() {
          window.clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = 0;
          currentCallback._isFirstCall = true;
        }

        const flush = () => {
          if (debounceTimerRef.current !== 0) {
            clearTimeoutAndLeadingRef();
            handleCallback(...args);
          }
        };
        const cancel = () => {
          clearTimeoutAndLeadingRef();
        };
        currentCallback.flush = flush;
        currentCallback.cancel = cancel;

        if (leading && isFirstCall) {
          handleCallback(...args);
          debounceTimerRef.current = window.setTimeout(() => clearTimeoutAndLeadingRef(), delay);
          return;
        }

        if (leading && !isFirstCall) {
          debounceTimerRef.current = window.setTimeout(() => clearTimeoutAndLeadingRef(), delay);
          return;
        }

        debounceTimerRef.current = window.setTimeout(flush, delay);
      },
      {
        flush: () => {},
        cancel: () => {},
        _isFirstCall: true,
      }
    );
    return currentCallback;
  }, [handleCallback, delay, leading]);

  useEffect(
    () => () => {
      if (flushOnUnmount) {
        lastCallback.flush();
      } else {
        lastCallback.cancel();
      }
    },
    [lastCallback, flushOnUnmount]
  );

  return lastCallback;
}
