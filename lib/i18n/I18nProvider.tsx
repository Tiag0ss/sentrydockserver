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
import { en } from './messages/en';
import { ptPT } from './messages/pt-PT';
import { es } from './messages/es';
import { fr } from './messages/fr';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_STORAGE_KEY,
  type Locale,
  type Messages,
} from './types';

const catalogs: Record<Locale, Messages> = {
  en,
  'pt-PT': ptPT,
  es,
  fr,
};

type Vars = Record<string, string | number>;

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Vars) => string;
  formatDate: (value: string | Date | null | undefined) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

function getByPath(obj: unknown, path: string): string | undefined {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(template: string, vars?: Vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (raw && (LOCALES as readonly string[]).includes(raw)) return raw as Locale;
  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLocaleState(readStoredLocale());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.lang = locale === 'pt-PT' ? 'pt' : locale;
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale, ready]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  const t = useCallback((key: string, vars?: Vars) => {
    const catalog = catalogs[locale] || en;
    const value = getByPath(catalog, key) ?? getByPath(en, key) ?? key;
    return interpolate(value, vars);
  }, [locale]);

  const formatDate = useCallback((value: string | Date | null | undefined) => {
    if (!value) return '—';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(locale);
  }, [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, t, formatDate }),
    [locale, setLocale, t, formatDate],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
