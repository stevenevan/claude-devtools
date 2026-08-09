import { useState } from 'react';
import { useStore } from '@renderer/store';

import { readCachedUIMode } from '../utils/uiModeBootstrap';

import type { UIMode } from '@shared/types';

export function useUIMode(): UIMode {
  const configuredMode = useStore((state) => state.appConfig?.general.uiMode);
  const [bootstrapMode] = useState(readCachedUIMode);

  return configuredMode ?? bootstrapMode;
}
