'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { RunFlowChart, RunStatusLegend, type NodeStatusMap, type RunGraph } from '../_components/RunFlowChart';

type RunStep = {
  id: string;
  nodeId: string;
  nodeType?: string;
  label?: string;
  status: string;
  attempts: number;
  lastError: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
};
type RunBranch = {
  id: string;
  agentId: string;
  agentName?: string | null;
  status: string;
  containerName: string;
};
type RunDetail = {
  id: string;
  status: string;
  currentNodeId: string | null;
  flowId: string;
  steps: RunStep[];
  branches: RunBranch[];
  flow: { id: string; name: string; graph: RunGraph } | null;
  nodeStatuses: NodeStatusMap;
};

function stepStatusColor(status: string): string {
  if (status === 'success') return '#3dd68c';
  if (status === 'failed') return 'var(--danger)';
  if (status === 'rejected') return 'var(--warn)';
  if (status === 'running') return 'var(--accent)';
  if (status === 'interrupted') return 'var(--warn)';
  return 'var(--muted)';
}

function statusLabelKey(status: string): string {
  const map: Record<string, string> = {
    success: 'runs.stepSuccess',
    failed: 'runs.stepFailed',
    rejected: 'runs.stepRejected',
    running: 'runs.stepRunning',
    interrupted: 'runs.stepInterrupted',
    pending: 'runs.stepPending',
  };
  return map[status] || '';
}

export default function RunDetailPage() {
  const { t, formatDate } = useI18n();
  const params = useParams();
  const id = String(params.id);
  const [run, setRun] = useState<RunDetail | null>(null);

  async function load() {
    setRun(await api<RunDetail>(`/runs/${id}`));
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(timer);
  }, [id]);

  if (!run) return <p>{t('runs.loading')}</p>;

  const currentNode = run.flow?.graph?.nodes?.find((n) => n.id === run.currentNodeId);
  const currentType = currentNode
    ? String(currentNode.type || currentNode.data?.nodeType || '')
    : '';
  const currentLabel = currentType
    ? (t(`nodes.${currentType}`) !== `nodes.${currentType}` ? t(`nodes.${currentType}`) : currentType)
    : run.currentNodeId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{run.flow?.name || `Run ${run.id.slice(0, 8)}…`}</h1>
        <span style={{ color: 'var(--muted)', fontSize: 14 }} title={run.id}>{run.id.slice(0, 8)}…</span>
        {run.flow && (
          <Link href="/flows" style={{ color: 'var(--muted)', fontSize: 14 }}>
            {t('runs.openFlow')}
          </Link>
        )}
      </header>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
        <span>
          {t('runs.status')}:{' '}
          <strong style={{ color: stepStatusColor(run.status) }}>{run.status}</strong>
        </span>
        {run.currentNodeId ? (
          <span style={{ color: 'var(--muted)' }}>
            {t('runs.step')}: {currentLabel}
          </span>
        ) : null}
      </div>

      {(run.status === 'awaiting_user' || run.status === 'waiting_approval') && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={async () => { await api(`/runs/${id}/continue`, { method: 'POST', body: JSON.stringify({ continue: true }) }); await load(); }}
            style={{ background: 'var(--accent)', border: 'none', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
            {run.status === 'waiting_approval' ? t('runs.approve') : t('runs.continue')}
          </button>
          <button type="button" onClick={async () => { await api(`/runs/${id}/continue`, { method: 'POST', body: JSON.stringify({ continue: false }) }); await load(); }}
            style={{ background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '8px 12px', borderRadius: 8, cursor: 'pointer' }}>
            {run.status === 'waiting_approval' ? t('runs.reject') : t('runs.abort')}
          </button>
        </div>
      )}

      {run.flow?.graph && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>{t('runs.flowchart')}</h2>
            <RunStatusLegend />
          </div>
          <RunFlowChart
            graph={run.flow.graph}
            nodeStatuses={run.nodeStatuses || {}}
            currentNodeId={run.currentNodeId}
          />
        </section>
      )}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{t('runs.steps')}</h2>
        {(!run.steps || run.steps.length === 0) && (
          <p style={{ color: 'var(--muted)', margin: 0, fontSize: 14 }}>{t('runs.noSteps')}</p>
        )}
        {run.steps?.map((s, index) => {
          const typeKey = `nodes.${s.nodeType || ''}`;
          const translated = s.nodeType ? t(typeKey) : '';
          const title = translated && translated !== typeKey
            ? translated
            : (s.label || s.nodeType || s.nodeId);
          const statusText = statusLabelKey(s.status)
            ? t(statusLabelKey(s.status))
            : s.status;
          return (
            <div
              key={s.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '12px 14px',
                background: 'var(--panel)',
              }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--muted)', fontSize: 12, fontVariantNumeric: 'tabular-nums', minWidth: 20 }}>
                  {index + 1}.
                </span>
                <strong style={{ fontSize: 14 }}>{title}</strong>
                <span style={{
                  color: stepStatusColor(s.status),
                  fontWeight: 600,
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                }}>
                  {statusText}
                </span>
                {s.attempts > 1 && (
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {t('runs.attempts')} ×{s.attempts}
                  </span>
                )}
                <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 'auto' }} title={s.nodeId}>
                  {s.startedAt ? formatDate(s.startedAt) : null}
                </span>
              </div>
              {s.lastError && (
                <div style={{
                  marginTop: 8,
                  marginLeft: 30,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'rgba(240, 113, 120, 0.1)',
                  color: 'var(--danger)',
                  fontSize: 13,
                  lineHeight: 1.4,
                }}>
                  {s.lastError}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {run.branches?.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{t('runs.branches')}</h2>
          {run.branches.map((b) => (
            <div key={b.id} style={{
              borderBottom: '1px solid var(--border)',
              padding: '8px 4px',
              fontSize: 14,
            }}>
              <strong>{b.agentName || b.agentId.slice(0, 8)}</strong>
              {b.containerName ? <span style={{ color: 'var(--muted)' }}> · {b.containerName}</span> : null}
              {' — '}
              <span style={{ color: stepStatusColor(b.status) }}>{b.status}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
