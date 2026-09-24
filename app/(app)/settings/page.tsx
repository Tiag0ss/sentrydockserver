'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { PageHeader, Input, Alert, Panel } from '@/components/ui';

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
    <div className="sd-page">
      <PageHeader title={t('settings.title')} />
      {error ? <Alert>{error}</Alert> : null}
      <Panel>
        <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>{t('settings.settingsSection')}</h2>
        <div className="sd-stack">
          {rows.map((r) => (
            <div key={r.key} className="sd-form-row" style={{ alignItems: 'center' }}>
              <code style={{ minWidth: 180, fontSize: 12 }}>{r.key}</code>
              <Input
                defaultValue={r.value}
                onBlur={async (e) => {
                  await api(`/settings/${r.key}`, { method: 'PUT', body: JSON.stringify({ value: e.target.value }) });
                }}
              />
            </div>
          ))}
        </div>
        <p style={{ color: 'var(--sd-muted)', fontSize: 13, margin: '12px 0 0' }}>{t('settings.tlsHint')}</p>
      </Panel>
    </div>
  );
}
