import { useCallback, useState } from 'react';

export interface UseDisclosureOptions {
  onOpen?: () => void;
  onClose?: () => void;
}

export interface UseDisclosureHandlers {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export type UseDisclosureReturnValue = [boolean, UseDisclosureHandlers];

export function useDisclosure(
  initialState = false,
  options: UseDisclosureOptions = {}
): UseDisclosureReturnValue {
  const [opened, setOpened] = useState(initialState);
  const { onOpen, onClose } = options;

  // ponytail: useCallback required — returned from hook; callers include in toggle dep array
  const open = useCallback(() => {
    setOpened((isOpened) => {
      if (!isOpened) {
        onOpen?.();
        return true;
      }
      return isOpened;
    });
  }, [onOpen]);

  // ponytail: useCallback required — returned from hook; callers include in toggle dep array
  const close = useCallback(() => {
    setOpened((isOpened) => {
      if (isOpened) {
        onClose?.();
        return false;
      }
      return isOpened;
    });
  }, [onClose]);

  // ponytail: useCallback required — returned from hook; callers may include in dep arrays
  const toggle = useCallback(() => {
    if (opened) {
      close();
    } else {
      open();
    }
  }, [close, open, opened]);

  return [opened, { open, close, toggle }];
}
