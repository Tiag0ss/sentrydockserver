'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import { PageHeader, Alert, EmptyState, Panel } from '@/components/ui';
import { IconButton, IconOpen, IconRefresh } from '@/components/IconActions';

type Run = {
  id: string;
  flowId: string;
  flowName: string;
  status: string;
  currentNodeId: string | null;
  currentNodeType?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  triggerSource: string;
  dryRun?: boolean | number;
  context?: { containerName?: string; agentId?: string; image?: string } | null;
};

function contextHint(r: Run): string | null {
  const parts = [r.context?.containerName, r.context?.image].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function humanStepLabel(t: (key: string) => string, r: Run): string | null {
  const type = r.currentNodeType
    || (r.currentNodeId ? r.currentNodeId.match(/^([a-z][a-z0-9_]*)-/i)?.[1] : null);
  if (!type) return null;
  const key = `nodes.${type}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return type.replace(/_/g, ' ');
}

function runStatusColor(status: string): string {
  if (status === 'success') return '#3dd68c';
  if (status === 'failed' || status === 'aborted' || status === 'rejected') return 'var(--sd-danger)';
  if (status === 'running') return 'var(--sd-accent)';
  if (status === 'waiting_approval' || status === 'awaiting_user' || status === 'interrupted') return 'var(--sd-warn)';
  return 'var(--sd-muted)';
}

export default function RunsPage() {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [active, setActive] = useState<Run[]>([]);
  const [history, setHistory] = useState<Run[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setActive(await api('/runs?status=active'));
    setHistory(await api('/runs?status=history'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function rerun(runId: string) {
    setBusyId(runId);
    setError('');
    try {
      const res = await api<{ runId: string }>(`/runs/${runId}/rerun`, { method: 'POST', body: '{}' });
      router.push(`/runs/${res.runId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('runs.rerunError'));
      setBusyId(null);
    }
  }

  function RunCard({ r, showStep }: { r: Run; showStep?: boolean }) {
    const hint = contextHint(r);
    const busy = busyId === r.id;
    const step = showStep ? humanStepLabel(t, r) : null;
    return (
      <Panel className="sd-entity-card">
        <div className="sd-entity-item">
          <div className="sd-entity-main">
            <div className="sd-entity-top">
              <strong className="sd-entity-name">{r.flowName}</strong>
              <span className="sd-entity-status" style={{ color: runStatusColor(r.status) }}>
                {tt(t, 'status', r.status)}
              </span>
              {r.dryRun ? (
                <span className="sd-entity-badge" style={{ color: 'var(--sd-warn)' }}>{t('runs.dryRunBadge')}</span>
              ) : null}
            </div>
            <div className="sd-entity-meta">
              <span title={r.id}>{r.id.slice(0, 8)}…</span>
              {' · '}
              {tt(t, 'trigger', r.triggerSource)}
              {' · '}
              {formatDate(r.finishedAt || r.startedAt)}
              {hint ? <> · {hint}</> : null}
              {step ? <> · {t('runs.step')}: {step}</> : null}
            </div>
          </div>
          <div className="sd-entity-actions">
            <IconButton label={t('runs.openDetail')} onClick={() => router.push(`/runs/${r.id}`)}>
              <IconOpen />
            </IconButton>
            <IconButton
              label={t('runs.rerun')}
              tone="primary"
              disabled={busy || (busyId !== null && !busy)}
              onClick={() => { void rerun(r.id); }}
            >
              <IconRefresh />
            </IconButton>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <div className="sd-page sd-page-compact">
      <PageHeader title={t('runs.title')} subtitle={t('runs.subtitle')} />
      {error ? <Alert>{error}</Alert> : null}

      <div className="sd-section-head">
        <h2>{t('runs.active')}</h2>
      </div>
      {active.length === 0 ? <EmptyState>{t('runs.emptyActive')}</EmptyState> : (
        <div className="sd-entity-list">
          {active.map((r) => <RunCard key={r.id} r={r} showStep />)}
        </div>
      )}

      <div className="sd-section-head" style={{ marginTop: 8 }}>
        <h2>{t('runs.history')}</h2>
      </div>
      {history.length === 0 ? <EmptyState>{t('runs.emptyHistory')}</EmptyState> : (
        <div className="sd-entity-list">
          {history.map((r) => <RunCard key={r.id} r={r} />)}
        </div>
      )}
    </div>
  );
}
