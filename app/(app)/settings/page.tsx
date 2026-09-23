'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';

export default function SettingsPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        setRows(await api('/settings'));
      } catch (e) {
        setError(e instanceof Error ? e.message : t('common.error'));
      }
    })();
  }, [t]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h1 style={{ margin: 0 }}>{t('settings.title')}</h1>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <section>
        <h2>{t('settings.settingsSection')}</h2>
        {rows.map((r) => (
          <div key={r.key} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <code style={{ minWidth: 200 }}>{r.key}</code>
            <input
              defaultValue={r.value}
              style={input}
              onBlur={async (e) => {
                await api(`/settings/${r.key}`, { method: 'PUT', body: JSON.stringify({ value: e.target.value }) });
              }}
            />
          </div>
        ))}
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          {t('settings.tlsHint')}
        </p>
      </section>
    </div>
  );
}

const input: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)' };
