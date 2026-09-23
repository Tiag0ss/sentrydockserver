export const LOCALES = ['en', 'pt-PT', 'es', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'sentrydock.locale';

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  'pt-PT': 'Português (PT)',
  es: 'Español',
  fr: 'Français',
};

/** Deep string map matching the English catalog shape. */
export type Messages = {
  [K in keyof import('./messages/en').EnMessages]: {
    [P in keyof import('./messages/en').EnMessages[K]]: string;
  };
};
