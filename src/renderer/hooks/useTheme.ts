import { useCallback, useEffect, useState } from 'react';

import { useShallow } from 'zustand/react/shallow';

import { useStore } from '../store';

type Theme = 'dark' | 'light' | 'system';
type ResolvedTheme = 'dark' | 'light';
export type ThemePreset = 'default' | 'nord' | 'solarized' | 'monokai' | 'high-contrast';

export const THEME_PRESETS: { value: ThemePreset; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'nord', label: 'Nord' },
  { value: 'solarized', label: 'Solarized Dark' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'high-contrast', label: 'High Contrast' },
];

const THEME_CACHE_KEY = 'claude-devtools-theme-cache';
const PRESET_CACHE_KEY = 'claude-devtools-theme-preset';

/**
 * Hook to manage theme state and application.
 * - Fetches theme preference from config on mount
 * - Listens to system theme changes when set to 'system'
 * - Applies theme class to document root
 * - Caches theme in localStorage for flash prevention
 */
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

  const setPreset = useCallback((p: ThemePreset) => {
    setPresetState(p);
    try {
      localStorage.setItem(PRESET_CACHE_KEY, p);
    } catch {
      // localStorage may not be available
    }
  }, []);

  // Fetch config on mount if not loaded
  useEffect(() => {
    if (!appConfig) {
      void fetchConfig();
    }
  }, [appConfig, fetchConfig]);

  // Get configured theme
  const configuredTheme: Theme = appConfig?.general?.theme ?? 'dark';

  // Get system theme preference
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

    // Remove existing theme and preset classes
    root.classList.remove('dark', 'light', 'theme-nord', 'theme-solarized', 'theme-monokai', 'theme-high-contrast');

    // Add theme class
    root.classList.add(resolvedTheme);

    // Add preset class (only for dark mode)
    if (resolvedTheme === 'dark' && preset !== 'default') {
      root.classList.add(`theme-${preset}`);
    }
  }, [resolvedTheme, preset]);

  return {
    theme: configuredTheme,
    resolvedTheme,
    isDark: resolvedTheme === 'dark',
    isLight: resolvedTheme === 'light',
    preset,
    setPreset,
  };
}
