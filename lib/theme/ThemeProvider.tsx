'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyThemePreferences,
  getStoredThemeMode,
  getStoredThemePalette,
  setThemeMode as persistMode,
  setThemePalette as persistPalette,
  type ThemeMode,
  type ThemePalette,
} from '@/lib/theme';

type ThemeCtx = {
  mode: ThemeMode;
  palette: ThemePalette;
  setMode: (mode: ThemeMode) => void;
  setPalette: (palette: ThemePalette) => void;
};

const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [palette, setPaletteState] = useState<ThemePalette>('dock');

  useEffect(() => {
    applyThemePreferences();
    setModeState(getStoredThemeMode());
    setPaletteState(getStoredThemePalette());

    const onMode = (e: Event) => {
      const detail = (e as CustomEvent<ThemeMode>).detail;
      if (detail) setModeState(detail);
    };
    const onPalette = (e: Event) => {
      const detail = (e as CustomEvent<ThemePalette>).detail;
      if (detail) setPaletteState(detail);
    };
    const onScheme = () => {
      if (getStoredThemeMode() === 'system') applyThemePreferences();
    };
    window.addEventListener('theme-mode-change', onMode);
    window.addEventListener('theme-palette-change', onPalette);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', onScheme);
    return () => {
      window.removeEventListener('theme-mode-change', onMode);
      window.removeEventListener('theme-palette-change', onPalette);
      mq.removeEventListener('change', onScheme);
    };
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    persistMode(m);
    setModeState(m);
  }, []);

  const setPalette = useCallback((p: ThemePalette) => {
    persistPalette(p);
    setPaletteState(p);
  }, []);

  const value = useMemo(() => ({ mode, palette, setMode, setPalette }), [mode, palette, setMode, setPalette]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme outside ThemeProvider');
  return ctx;
}
