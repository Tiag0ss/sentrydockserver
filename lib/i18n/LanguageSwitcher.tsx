'use client';

import { LOCALES, LOCALE_LABELS, type Locale } from './types';
import { useI18n } from './I18nProvider';

type Props = {
  compact?: boolean;
};

export function LanguageSwitcher({ compact }: Props) {
  const { locale, setLocale, t } = useI18n();

  return (
    <label style={{
      display: 'flex',
      flexDirection: compact ? 'row' : 'column',
      gap: compact ? 8 : 4,
      alignItems: compact ? 'center' : 'stretch',
      fontSize: 12,
      color: 'var(--sd-muted)',
    }}>
      {!compact && <span className="sd-control-label" style={{ marginBottom: 0 }}>{t('common.language')}</span>}
      <select
        aria-label={t('common.language')}
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="sd-select"
        style={{
          fontSize: 13,
          padding: compact ? '6px 8px' : '8px 10px',
          minHeight: compact ? 32 : 36,
        }}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>{LOCALE_LABELS[code]}</option>
        ))}
      </select>
    </label>
  );
}
