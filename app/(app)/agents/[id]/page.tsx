'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import { PageHeader, Alert, Panel } from '@/components/ui';
import { AgentContainersPanel } from '@/components/AgentContainersPanel';

type Agent = {
  id: string;
  name: string;
  status: string;
  online: boolean;
  transport: string;
  protocolVersion: number | null;
  agentVersion?: string | null;
  labels?: string[];
  metricsIntervalSec?: number;
  metricsRetentionHours?: number;
  meta?: {
    containers?: number;
    danglingImages?: number;
    diskUsedBytes?: number;
    diskTotalBytes?: number;
  } | null;
};

export default function AgentDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const id = String(params.id || '');
  const [agent, setAgent] = useState<Agent | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const rows = await api<Agent[]>('/agents');
        const found = rows.find((a) => a.id === id) || null;
        if (!cancelled) {
          setAgent(found);
          if (!found) setError(t('agents.notFound'));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('common.error'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (id) void load();
    return () => { cancelled = true; };
  }, [id, t]);

  const transportLabel = agent?.transport === 'grpc'
    ? 'gRPC'
    : agent?.transport === 'ws'
      ? 'WebSocket'
      : (agent?.transport || '');

  const metaBits = agent ? [
    agent.agentVersion ? `${t('agents.version')} ${agent.agentVersion}` : null,
    transportLabel ? `${t('agents.transport')} ${transportLabel}` : null,
    `${t('agents.protocol')} ${agent.protocolVersion ?? '—'}`,
    `${t('agents.metricsInterval')}: ${agent.metricsIntervalSec ?? 30}s`,
    `${t('agents.metricsRetention')}: ${agent.metricsRetentionHours ?? 24}h`,
  ].filter(Boolean) : [];

  return (
    <div className="sd-page sd-page-compact">
      <PageHeader
        title={agent?.name || t('agents.containersTitle')}
        subtitle={metaBits.join(' · ') || undefined}
        actions={(
          <Link href="/agents" className="sd-entity-link">
            ← {t('common.back')}
          </Link>
        )}
      />

      {error ? <Alert>{error}</Alert> : null}
      {loading && !agent ? (
        <div className="sd-entity-muted">{t('common.loading')}</div>
      ) : null}

      {agent ? (
        <>
          <div style={{ marginBottom: 16 }}>
            <Panel className="sd-entity-card">
              <div className="sd-entity-top">
                <strong className="sd-entity-name">{agent.name}</strong>
                <span
                  className="sd-entity-status"
                  style={{ color: agent.online ? '#3dd68c' : 'var(--sd-muted)' }}
                >
                  {agent.online
                    ? t('agents.online')
                    : (agent.status ? tt(t, 'status', agent.status) : t('agents.offline'))}
                </span>
              </div>
              {(agent.labels?.length || 0) > 0 ? (
                <div className="sd-chip-row" style={{ marginTop: 8 }}>
                  {agent.labels!.map((label) => (
                    <span key={label} className="sd-chip">{label}</span>
                  ))}
                </div>
              ) : null}
              <div style={{ fontSize: 12, color: 'var(--sd-muted)', marginTop: 10 }}>
                {t('agents.containersHint')}
              </div>
            </Panel>
          </div>

          <AgentContainersPanel
            agentId={agent.id}
            agentName={agent.name}
            online={agent.online}
            pollMs={Math.max(10_000, (agent.metricsIntervalSec || 30) * 1000)}
            showHeader={false}
          />
        </>
      ) : null}
    </div>
  );
}
