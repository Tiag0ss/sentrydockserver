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
    <div className="sd-page sd-page-compact">
      <PageHeader title={t('logs.title')} />
      {logs.length === 0 ? <EmptyState>—</EmptyState> : (
        <div className="sd-entity-list">
          {logs.map((l) => (
            <Panel key={l.id} className="sd-entity-card">
              <div className="sd-entity-item">
                <div className="sd-entity-main">
                  <div className="sd-entity-top">
                    <strong className="sd-entity-name" style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.8rem' }}>
                      {l.action}
                    </strong>
                    <span className="sd-entity-badge" style={{ color: 'var(--sd-accent)' }}>{l.actor}</span>
                  </div>
                  <div className="sd-entity-meta">
                    {formatDate(l.ts)}
                    {l.flowRunId ? ` · run ${l.flowRunId.slice(0, 8)}…` : ''}
                  </div>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
