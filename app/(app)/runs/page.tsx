'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import { ActionIconButton, IconOpen, IconRerun, StatusPill } from './_components/RunActionIcons';
import { PageHeader, Alert, EmptyState } from '@/components/ui';

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
    return (
      <article className="sd-panel" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <strong style={{ fontSize: 15 }}>{r.flowName}</strong>
            <StatusPill status={r.status} />
            {r.dryRun ? (
              <span style={{ fontSize: 11, color: 'var(--sd-warn)' }}>{t('runs.dryRunBadge')}</span>
            ) : null}
          </div>
          <div style={{ color: 'var(--sd-muted)', fontSize: 12, lineHeight: 1.45 }}>
            <span title={r.id}>{r.id.slice(0, 8)}…</span>
            {' · '}
            <span>{tt(t, 'trigger', r.triggerSource)}</span>
            {' · '}
            <span>{formatDate(r.finishedAt || r.startedAt)}</span>
            {hint ? <> · {hint}</> : null}
            {showStep && humanStepLabel(t, r) ? (
              <> · {t('runs.step')}: {humanStepLabel(t, r)}</>
            ) : null}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <ActionIconButton
            title={t('runs.openDetail')}
            onClick={() => router.push(`/runs/${r.id}`)}
          >
            <IconOpen title={t('runs.openDetail')} />
          </ActionIconButton>
          <ActionIconButton
            title={t('runs.rerun')}
            primary
            disabled={busy || (busyId !== null && !busy)}
            onClick={() => { void rerun(r.id); }}
          >
            <IconRerun title={t('runs.rerun')} />
          </ActionIconButton>
        </div>
      </article>
    );
  }

  return (
    <div className="sd-page">
      <PageHeader title={t('runs.title')} subtitle={t('runs.subtitle')} />
      {error ? <Alert>{error}</Alert> : null}

      <section className="sd-stack">
        <h2 style={{ margin: 0, fontSize: 16 }}>{t('runs.active')}</h2>
        {active.length === 0 ? <EmptyState>{t('runs.emptyActive')}</EmptyState> : null}
        {active.map((r) => <RunCard key={r.id} r={r} showStep />)}
      </section>

      <section className="sd-stack">
        <h2 style={{ margin: 0, fontSize: 16 }}>{t('runs.history')}</h2>
        {history.length === 0 ? <EmptyState>{t('runs.emptyHistory')}</EmptyState> : null}
        {history.map((r) => <RunCard key={r.id} r={r} />)}
      </section>
    </div>
  );
}
