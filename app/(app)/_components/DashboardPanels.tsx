'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';

export type DashboardData = {
  activeRuns: Array<{ id: string; flowId: string; flowName: string; status: string; currentNodeId: string | null; startedAt: string }>;
  upcomingPolicies: Array<{ id: string; name: string; nextRunAt: string; cron: string; timezone: string }>;
  history: Array<{ id: string; flowId: string; flowName: string; status: string; finishedAt: string | null; startedAt?: string }>;
  agents: Array<{ id: string; name: string; status: string; online: boolean; meta: { diskUsedBytes?: number; diskTotalBytes?: number } | null }>;
  pendingUpdates: Array<{ id: string; image: string; status: string }>;
  attention: Array<{ id: string; flowName?: string; status: string }>;
  summary: { agentsOnline: number; activeRuns: number; pendingUpdates: number };
};

export function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <div style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace' }}>{value}</div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </section>
  );
}

export function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ color: 'var(--muted)', fontSize: 14 }}>{children}</div>;
}

export function Badge({ children, ok, danger, warn }: { children: React.ReactNode; ok?: boolean; danger?: boolean; warn?: boolean }) {
  const color = danger ? 'var(--danger)' : ok ? 'var(--ok)' : warn ? 'var(--warn)' : 'var(--accent)';
  return (
    <span style={{
      fontSize: 12,
      fontFamily: 'IBM Plex Mono, monospace',
      border: `1px solid ${color}`,
      color,
      borderRadius: 999,
      padding: '2px 8px',
    }}>{children}</span>
  );
}

export function ApproveButton({ id, onDone }: { id: string; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={async () => {
        await api(`/update-events/${id}/approve`, { method: 'POST', body: '{}' });
        onDone();
      }}
      style={{ background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}
    >
      {t('dashboard.approve')}
    </button>
  );
}

export function DashboardPanels({ data, onReload }: { data: DashboardData; onReload: () => void }) {
  const { t, formatDate } = useI18n();

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <Stat label={t('dashboard.agentsOnline')} value={data.summary.agentsOnline} />
        <Stat label={t('dashboard.activeRuns')} value={data.summary.activeRuns} />
        <Stat label={t('dashboard.pendingUpdates')} value={data.summary.pendingUpdates} />
      </div>

      <Section title={t('dashboard.runningNow')}>
        {data.activeRuns.length === 0 && <Empty>{t('dashboard.noRunning')}</Empty>}
        {data.activeRuns.map((r) => (
          <Row key={r.id}>
            <Link href={`/runs/${r.id}`}>{r.flowName}</Link>
            <Badge>{r.status}</Badge>
            <span style={{ color: 'var(--muted)' }}>{t('dashboard.step')}: {r.currentNodeId || '—'}</span>
          </Row>
        ))}
      </Section>

      <Section title={t('dashboard.upcoming')}>
        {data.upcomingPolicies.length === 0 && <Empty>{t('dashboard.noPolicies')}</Empty>}
        {data.upcomingPolicies.map((p) => (
          <Row key={p.id}>
            <strong>{p.name}</strong>
            <span style={{ color: 'var(--muted)' }}>{p.cron} ({p.timezone})</span>
            <span>{formatDate(p.nextRunAt)}</span>
          </Row>
        ))}
      </Section>

      <Section title={t('dashboard.attention')}>
        {data.attention.length === 0 && data.pendingUpdates.length === 0 && <Empty>{t('dashboard.allOk')}</Empty>}
        {data.pendingUpdates.map((u) => (
          <Row key={u.id}>
            <span>{t('dashboard.update')}: {u.image}</span>
            <ApproveButton id={u.id} onDone={onReload} />
          </Row>
        ))}
        {data.attention.map((a) => (
          <Row key={a.id}>
            <Link href={`/runs/${a.id}`}>{a.flowName || `Run ${a.id.slice(0, 8)}…`}</Link>
            <Badge warn>{a.status}</Badge>
          </Row>
        ))}
      </Section>

      <Section title={t('dashboard.recentHistory')}>
        {data.history.map((r) => (
          <Row key={r.id}>
            <Link href={`/runs/${r.id}`}>{r.flowName}</Link>
            <Badge ok={r.status === 'success'} danger={r.status === 'failed' || r.status === 'aborted' || r.status === 'rejected'}>{r.status}</Badge>
          </Row>
        ))}
      </Section>

      <Section title={t('dashboard.agents')}>
        {data.agents.map((a) => (
          <Row key={a.id}>
            <span>{a.name}</span>
            <Badge ok={a.online} danger={!a.online}>{a.online ? t('agents.online') : a.status}</Badge>
            {a.meta?.diskUsedBytes != null && a.meta?.diskTotalBytes != null && (
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                {t('dashboard.disk')} {Math.round((a.meta.diskUsedBytes / a.meta.diskTotalBytes) * 100)}%
              </span>
            )}
          </Row>
        ))}
      </Section>
    </>
  );
}
