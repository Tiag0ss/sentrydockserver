'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { ActionIconButton, IconOpen, IconRerun, StatusPill } from '../runs/_components/RunActionIcons';

export type DashboardData = {
  activeRuns: Array<{
    id: string;
    flowId: string;
    flowName: string;
    status: string;
    currentNodeId: string | null;
    currentNodeType?: string | null;
    startedAt: string;
    triggerSource?: string;
    context?: { containerName?: string; image?: string } | null;
  }>;
  upcomingPolicies: Array<{ id: string; name: string; nextRunAt: string; cron: string; timezone: string }>;
  history: Array<{
    id: string;
    flowId: string;
    flowName: string;
    status: string;
    finishedAt: string | null;
    startedAt?: string;
    triggerSource?: string;
    currentNodeType?: string | null;
    context?: { containerName?: string; image?: string } | null;
  }>;
  agents: Array<{ id: string; name: string; status: string; online: boolean; meta: { diskUsedBytes?: number; diskTotalBytes?: number } | null }>;
  pendingUpdates: Array<{ id: string; image: string; status: string }>;
  attention: Array<{
    id: string;
    flowName?: string;
    status: string;
    currentNodeId?: string | null;
    currentNodeType?: string | null;
    context?: { containerName?: string; image?: string } | null;
  }>;
  summary: {
    agentsOnline: number;
    activeRuns: number;
    pendingUpdates: number;
    awaitingApproval?: number;
    unreadNotifications?: number;
  };
};

function humanStepLabel(
  t: (key: string) => string,
  currentNodeType?: string | null,
  currentNodeId?: string | null,
): string | null {
  const type = currentNodeType
    || (currentNodeId ? currentNodeId.match(/^([a-z][a-z0-9_]*)-/i)?.[1] : null);
  if (!type) return null;
  const key = `nodes.${type}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return type.replace(/_/g, ' ');
}

export function Stat({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <>
      <div style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace' }}>{value}</div>
    </>
  );
  const boxStyle: React.CSSProperties = {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 16,
    display: 'block',
    color: 'inherit',
    textDecoration: 'none',
    transition: 'border-color 0.15s ease',
  };
  if (href) {
    return (
      <Link
        href={href}
        style={boxStyle}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
      >
        {inner}
      </Link>
    );
  }
  return <div style={boxStyle}>{inner}</div>;
}

export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
        {action}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ color: 'var(--muted)', fontSize: 14 }}>{children}</div>;
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

function RunDashRow({
  id,
  flowName,
  status,
  meta,
  onRerun,
  busy,
}: {
  id: string;
  flowName: string;
  status: string;
  meta: string;
  onRerun?: () => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <div style={{
      display: 'flex',
      gap: 12,
      alignItems: 'center',
      padding: '10px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 }}>
          <strong style={{ fontSize: 14 }}>{flowName}</strong>
          <StatusPill status={status} />
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>{meta}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <ActionIconButton title={t('runs.openDetail')} onClick={() => router.push(`/runs/${id}`)}>
          <IconOpen title={t('runs.openDetail')} />
        </ActionIconButton>
        {onRerun && (
          <ActionIconButton title={t('runs.rerun')} primary disabled={busy} onClick={onRerun}>
            <IconRerun title={t('runs.rerun')} />
          </ActionIconButton>
        )}
      </div>
    </div>
  );
}

export function DashboardPanels({ data, onReload }: { data: DashboardData; onReload: () => void }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function rerun(runId: string) {
    setBusyId(runId);
    setError('');
    try {
      const res = await api<{ runId: string }>(`/runs/${runId}/rerun`, { method: 'POST', body: '{}' });
      router.push(`/runs/${res.runId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('runs.rerunError'));
      setBusyId(null);
      onReload();
    }
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <Stat label={t('dashboard.agentsOnline')} value={data.summary.agentsOnline} href="/agents" />
        <Stat label={t('dashboard.activeRuns')} value={data.summary.activeRuns} href="/runs" />
        <Stat label={t('dashboard.pendingUpdates')} value={data.summary.pendingUpdates} />
      </div>

      {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}

      <Section
        title={t('dashboard.attention')}
        action={<Link href="/runs" style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dashboard.viewRuns')}</Link>}
      >
        {data.attention.length === 0 && data.pendingUpdates.length === 0 && <Empty>{t('dashboard.allOk')}</Empty>}
        {data.pendingUpdates.map((u) => (
          <div key={u.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ flex: 1 }}>{t('dashboard.update')}: {u.image}</span>
            <ApproveButton id={u.id} onDone={onReload} />
          </div>
        ))}
        {data.attention.map((a) => {
          const step = humanStepLabel(t, a.currentNodeType, a.currentNodeId);
          return (
            <RunDashRow
              key={a.id}
              id={a.id}
              flowName={a.flowName || `Run ${a.id.slice(0, 8)}…`}
              status={a.status}
              meta={[
                t('dashboard.needsAction'),
                step ? `${t('dashboard.step')}: ${step}` : null,
                a.context?.containerName,
              ].filter(Boolean).join(' · ')}
            />
          );
        })}
      </Section>

      <Section
        title={t('dashboard.runningNow')}
        action={<Link href="/runs" style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dashboard.viewRuns')}</Link>}
      >
        {data.activeRuns.length === 0 && <Empty>{t('dashboard.noRunning')}</Empty>}
        {data.activeRuns.map((r) => {
          const step = humanStepLabel(t, r.currentNodeType, r.currentNodeId);
          return (
            <RunDashRow
              key={r.id}
              id={r.id}
              flowName={r.flowName}
              status={r.status}
              meta={[
                r.triggerSource,
                formatDate(r.startedAt),
                step ? `${t('dashboard.step')}: ${step}` : null,
                r.context?.containerName,
              ].filter(Boolean).join(' · ')}
              busy={busyId === r.id}
              onRerun={() => { void rerun(r.id); }}
            />
          );
        })}
      </Section>

      <Section title={t('dashboard.upcoming')}>
        {data.upcomingPolicies.length === 0 && <Empty>{t('dashboard.noPolicies')}</Empty>}
        {data.upcomingPolicies.map((p) => (
          <div key={p.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <strong>{p.name}</strong>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>{p.cron} ({p.timezone})</span>
            <span style={{ marginLeft: 'auto', fontSize: 13 }}>{formatDate(p.nextRunAt)}</span>
          </div>
        ))}
      </Section>

      <Section
        title={t('dashboard.recentHistory')}
        action={<Link href="/runs" style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dashboard.viewRuns')}</Link>}
      >
        {data.history.length === 0 && <Empty>{t('runs.emptyHistory')}</Empty>}
        {data.history.map((r) => (
          <RunDashRow
            key={r.id}
            id={r.id}
            flowName={r.flowName}
            status={r.status}
            meta={[
              r.triggerSource,
              formatDate(r.finishedAt || r.startedAt || null),
              r.context?.containerName,
            ].filter(Boolean).join(' · ')}
            busy={busyId === r.id}
            onRerun={() => { void rerun(r.id); }}
          />
        ))}
      </Section>
    </>
  );
}
