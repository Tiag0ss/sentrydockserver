export type ThemeMode = 'system' | 'light' | 'dark';

export type ThemePalette = 'dock' | 'catppuccin' | 'ocean' | 'forest';

export const THEME_PALETTES: ThemePalette[] = ['dock', 'catppuccin', 'ocean', 'forest'];

export const DEFAULT_THEME_PALETTE: ThemePalette = 'dock';

export const THEME_PALETTE_META: Record<
  ThemePalette,
  { labelKey: string; swatchLight: string; swatchDark: string }
> = {
  dock: { labelKey: 'palette.dock', swatchLight: '#0d9488', swatchDark: '#14b8a6' },
  catppuccin: { labelKey: 'palette.catppuccin', swatchLight: '#8839ef', swatchDark: '#cba6f7' },
  ocean: { labelKey: 'palette.ocean', swatchLight: '#0369a1', swatchDark: '#38bdf8' },
  forest: { labelKey: 'palette.forest', swatchLight: '#059669', swatchDark: '#34d399' },
};

export const THEME_MODE_STORAGE_KEY = 'sentrydock.themeMode';
export const THEME_PALETTE_STORAGE_KEY = 'sentrydock.themePalette';

const isThemeMode = (value: string): value is ThemeMode =>
  value === 'system' || value === 'light' || value === 'dark';

const isThemePalette = (value: string): value is ThemePalette =>
  THEME_PALETTES.includes(value as ThemePalette);

export function getStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem(THEME_MODE_STORAGE_KEY);
  if (!stored || !isThemeMode(stored)) return 'system';
  return stored;
}

export function getStoredThemePalette(): ThemePalette {
  if (typeof window === 'undefined') return DEFAULT_THEME_PALETTE;
  const stored = localStorage.getItem(THEME_PALETTE_STORAGE_KEY);
  if (!stored || !isThemePalette(stored)) return DEFAULT_THEME_PALETTE;
  return stored;
}

export function getResolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function applyThemePalette(palette: ThemePalette): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme-palette', palette);
}

export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const resolved = getResolvedTheme(mode);
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.classList.toggle('light', resolved === 'light');
  root.setAttribute('data-theme-mode', mode);
}

export function applyThemePreferences(): void {
  applyThemeMode(getStoredThemeMode());
  applyThemePalette(getStoredThemePalette());
}

export function setThemeMode(mode: ThemeMode): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  }
  applyThemeMode(mode);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('theme-mode-change', { detail: mode }));
  }
}

export function setThemePalette(palette: ThemePalette): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(THEME_PALETTE_STORAGE_KEY, palette);
  }
  applyThemePalette(palette);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('theme-palette-change', { detail: palette }));
  }
}

/** Inline script for early theme apply before paint (anti-FOUC). */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var r=document.documentElement;var m=localStorage.getItem('${THEME_MODE_STORAGE_KEY}');var p=localStorage.getItem('${THEME_PALETTE_STORAGE_KEY}');var resolved=m==='dark'?'dark':m==='light'?'light':(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');r.classList.add(resolved);r.classList.remove(resolved==='dark'?'light':'dark');if(m==='system'||m==='light'||m==='dark')r.setAttribute('data-theme-mode',m);else r.setAttribute('data-theme-mode','system');var ok=['dock','catppuccin','ocean','forest'];r.setAttribute('data-theme-palette',ok.indexOf(p)>=0?p:'dock');}catch(e){document.documentElement.classList.add('light');document.documentElement.setAttribute('data-theme-palette','dock');}})();`;
