'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';

type Run = {
  id: string;
  flowId: string;
  flowName: string;
  status: string;
  currentNodeId: string | null;
  startedAt: string;
  finishedAt?: string | null;
  triggerSource: string;
  context?: { containerName?: string; agentId?: string; image?: string } | null;
};

function statusColor(status: string): string {
  if (status === 'success') return '#3dd68c';
  if (status === 'failed' || status === 'aborted' || status === 'rejected') return 'var(--danger)';
  if (status === 'waiting_approval' || status === 'awaiting_user') return 'var(--warn)';
  if (status === 'running') return 'var(--accent)';
  return 'var(--text)';
}

function contextHint(r: Run): string | null {
  const parts = [
    r.context?.containerName,
    r.context?.image,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
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

  function RunRow({ r, showStep }: { r: Run; showStep?: boolean }) {
    const hint = contextHint(r);
    const busy = busyId === r.id;
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(140px, 1.4fr) minmax(90px, 0.7fr) minmax(80px, 0.6fr) minmax(120px, 1fr) auto',
        gap: 12,
        alignItems: 'center',
        padding: '10px 4px',
        borderBottom: '1px solid var(--border)',
        fontSize: 14,
      }}>
        <div style={{ minWidth: 0 }}>
          <Link href={`/runs/${r.id}`} style={{ fontWeight: 600, color: 'var(--text)', textDecoration: 'none' }}>
            {r.flowName}
          </Link>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
            <span title={r.id}>{r.id.slice(0, 8)}…</span>
            {hint ? <> · {hint}</> : null}
            {showStep && r.currentNodeId ? <> · {t('runs.step')} {r.currentNodeId}</> : null}
          </div>
        </div>
        <span style={{ color: statusColor(r.status), fontWeight: 600, fontSize: 13 }}>{r.status}</span>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>{r.triggerSource}</span>
        <span style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'right' }}>
          {formatDate(r.finishedAt || r.startedAt)}
        </span>
        <button
          type="button"
          onClick={() => { void rerun(r.id); }}
          disabled={busy || busyId !== null}
          title={t('runs.rerun')}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            borderRadius: 8,
            padding: '6px 10px',
            cursor: busy ? 'wait' : 'pointer',
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            opacity: busyId !== null && !busy ? 0.5 : 1,
          }}
        >
          {busy ? t('runs.rerunning') : t('runs.rerun')}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h1 style={{ margin: 0 }}>{t('runs.title')}</h1>
      {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}

      <section>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>{t('runs.active')}</h2>
        {active.length === 0 && (
          <p style={{ color: 'var(--muted)', margin: 0 }}>{t('runs.emptyActive')}</p>
        )}
        {active.map((r) => <RunRow key={r.id} r={r} showStep />)}
      </section>

      <section>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>{t('runs.history')}</h2>
        {history.length === 0 && (
          <p style={{ color: 'var(--muted)', margin: 0 }}>{t('runs.emptyHistory')}</p>
        )}
        {history.map((r) => <RunRow key={r.id} r={r} />)}
      </section>
    </div>
  );
}
