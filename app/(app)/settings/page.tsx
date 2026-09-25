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
    <div className="sd-page sd-page-compact">
      <PageHeader title={t('settings.title')} subtitle={t('settings.tlsHint')} />
      {error ? <Alert>{error}</Alert> : null}
      <div className="sd-section-head">
        <h2>{t('settings.settingsSection')}</h2>
      </div>
      {rows.length === 0 && !error ? <p style={{ color: 'var(--sd-muted)', fontSize: 13 }}>—</p> : null}
      <div className="sd-entity-list">
        {rows.map((r) => (
          <Panel key={r.key} className="sd-entity-card">
            <div className="sd-entity-item">
              <div className="sd-entity-main" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <code className="sd-entity-name" style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.75rem', minWidth: 160 }}>
                  {r.key}
                </code>
                <Input
                  className="sd-input sd-input-sm"
                  defaultValue={r.value}
                  style={{ flex: 1, minWidth: 180 }}
                  onBlur={async (e) => {
                    await api(`/settings/${r.key}`, { method: 'PUT', body: JSON.stringify({ value: e.target.value }) });
                  }}
                />
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
