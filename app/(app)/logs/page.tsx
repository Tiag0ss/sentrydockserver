'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { PageHeader, Panel, EmptyState } from '@/components/ui';

export default function LogsPage() {
  const { t, formatDate } = useI18n();
  const [logs, setLogs] = useState<Array<{ id: string; ts: string; actor: string; action: string; flowRunId: string | null; payload: unknown }>>([]);
  useEffect(() => {
    void api<typeof logs>('/logs?limit=200').then(setLogs);
  }, []);
  return (
    <div className="sd-page">
      <PageHeader title={t('logs.title')} />
      <Panel>
        {logs.length === 0 ? <EmptyState>—</EmptyState> : null}
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }}>
          {logs.map((l) => (
            <div key={l.id} style={{ borderBottom: '1px solid var(--sd-border)', padding: '8px 0' }}>
              <span style={{ color: 'var(--sd-muted)' }}>{formatDate(l.ts)}</span>{' '}
              <span style={{ color: 'var(--sd-accent)' }}>{l.actor}</span> {l.action}
              {l.flowRunId ? <span style={{ color: 'var(--sd-muted)' }}> run={l.flowRunId.slice(0, 8)}</span> : null}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
