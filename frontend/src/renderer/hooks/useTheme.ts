import { useCallback, useEffect, useState } from 'react';

import { applyTheme, revertTheme } from '@renderer/utils/themeApplier';
import { useShallow } from 'zustand/react/shallow';

import { useStore } from '../store';

type Theme = 'dark' | 'light' | 'system';
type ResolvedTheme = 'dark' | 'light';
export type ThemePreset = 'default' | 'nord' | 'solarized' | 'monokai' | 'high-contrast';

const THEME_CACHE_KEY = 'claude-devtools-theme-cache';
const PRESET_CACHE_KEY = 'claude-devtools-theme-preset';

export function useTheme(): {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  isDark: boolean;
  isLight: boolean;
  preset: ThemePreset;
  setPreset: (preset: ThemePreset) => void;
} {
  const { appConfig, fetchConfig } = useStore(
    useShallow((s) => ({
      appConfig: s.appConfig,
      fetchConfig: s.fetchConfig,
    }))
  );
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    // Initialize from cache to prevent flash
    try {
      const cached = localStorage.getItem(THEME_CACHE_KEY);
      if (cached === 'light') return 'light';
    } catch {
      // localStorage may not be available
    }
    return 'dark';
  });

  const [preset, setPresetState] = useState<ThemePreset>(() => {
    try {
      return (localStorage.getItem(PRESET_CACHE_KEY) as ThemePreset) ?? 'default';
    } catch {
      return 'default';
    }
  });

  const setPreset = (p: ThemePreset): void => {
    setPresetState(p);
    try {
      localStorage.setItem(PRESET_CACHE_KEY, p);
    } catch {
      // localStorage may not be available
    }
  };

  // Fetch config on mount if not loaded
  useEffect(() => {
    if (!appConfig) {
      void fetchConfig();
    }
  }, [appConfig, fetchConfig]);

  const configuredTheme: Theme = appConfig?.general?.theme ?? 'dark';

  // ponytail: useCallback required — in useEffect dep array
  const getSystemTheme = useCallback((): ResolvedTheme => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }, []);

  // Resolve 'system' theme and listen for changes
  useEffect(() => {
    const updateTheme = (): void => {
      const resolved = configuredTheme === 'system' ? getSystemTheme() : configuredTheme;
      setResolvedTheme(resolved);

      // Cache for flash prevention
      try {
        localStorage.setItem(THEME_CACHE_KEY, resolved);
      } catch {
        // localStorage may not be available
      }
    };

    updateTheme();

    // Listen to system theme changes when in 'system' mode
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (): void => {
      if (configuredTheme === 'system') {
        updateTheme();
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [configuredTheme, getSystemTheme]);

  // Apply theme and preset classes to document root
  useEffect(() => {
    const root = document.documentElement;

    root.classList.remove(
      'dark',
      'light',
      'theme-nord',
      'theme-solarized',
      'theme-monokai',
      'theme-high-contrast'
    );

    root.classList.add(resolvedTheme);

    // Add preset class (only for dark mode)
    if (resolvedTheme === 'dark' && preset !== 'default') {
      root.classList.add(`theme-${preset}`);
    }
  }, [resolvedTheme, preset]);

  // Apply custom CSS-variable theme overrides (sprint 34)
  useEffect(() => {
    const activeId = appConfig?.themes?.activeId;
    const custom = appConfig?.themes?.custom ?? [];
    const active = activeId ? custom.find((t) => t.id === activeId) : undefined;
    if (!active) {
      revertTheme();
      return;
    }
    applyTheme(active.overrides);
    return () => {
      revertTheme();
    };
  }, [appConfig?.themes?.activeId, appConfig?.themes?.custom]);

  return {
    theme: configuredTheme,
    resolvedTheme,
    isDark: resolvedTheme === 'dark',
    isLight: resolvedTheme === 'light',
    preset,
    setPreset,
  };
}
