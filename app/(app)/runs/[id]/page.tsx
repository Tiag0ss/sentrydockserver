'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { RunFlowChart, RunStatusLegend, type NodeStatusMap, type RunGraph } from '../_components/RunFlowChart';

type RunStep = { id: string; nodeId: string; status: string; attempts: number; lastError: string | null };
type RunBranch = { id: string; agentId: string; status: string; containerName: string };
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

export default function RunDetailPage() {
  const { t } = useI18n();
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Run {run.id.slice(0, 8)}…</h1>
        {run.flow && (
          <Link href="/flows" style={{ color: 'var(--muted)', fontSize: 14 }}>
            {run.flow.name}
          </Link>
        )}
      </header>

      <div>
        {t('runs.status')}: <strong>{run.status}</strong>
        {run.currentNodeId ? <> · {t('runs.step')}: {run.currentNodeId}</> : null}
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

      <h2 style={{ margin: 0, fontSize: 16 }}>{t('runs.steps')}</h2>
      {run.steps?.map((s) => (
        <div key={s.id} style={{ borderBottom: '1px solid var(--border)', padding: 8 }}>
          <span style={{
            color: s.status === 'success' ? '#3dd68c'
              : s.status === 'failed' ? 'var(--danger)'
                : s.status === 'rejected' ? 'var(--warn)'
                  : s.status === 'running' ? 'var(--accent)'
                    : 'var(--text)',
          }}>
            {s.nodeId} — {s.status}
          </span>
          {' '}— {t('runs.attempts')} {s.attempts}
          {s.lastError && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{s.lastError}</div>}
        </div>
      ))}
      {run.branches?.length > 0 && (
        <>
          <h2 style={{ margin: 0, fontSize: 16 }}>{t('runs.branches')}</h2>
          {run.branches.map((b) => (
            <div key={b.id}>{b.agentId} / {b.containerName} — {b.status}</div>
          ))}
        </>
      )}
    </div>
  );
}
