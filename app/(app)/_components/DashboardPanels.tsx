'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import { ActionIconButton, IconOpen, IconRerun, StatusPill } from '../runs/_components/RunActionIcons';

const HISTORY_PAGE_SIZE_KEY = 'sentrydock.dashboard.historyPageSize';
const HISTORY_PAGE_SIZES = [10, 25, 50, 100] as const;

function readHistoryPageSize(): number {
  if (typeof window === 'undefined') return 10;
  const raw = Number(window.localStorage.getItem(HISTORY_PAGE_SIZE_KEY));
  return (HISTORY_PAGE_SIZES as readonly number[]).includes(raw) ? raw : 10;
}

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
  agents: Array<{
    id: string;
    name: string;
    status: string;
    online: boolean;
    labels?: string[];
    inventory?: {
      diskUsedBytes?: number | null;
      diskTotalBytes?: number | null;
      danglingImages?: number | null;
      containers?: number | null;
    } | null;
    meta: Record<string, unknown> | null;
  }>;
  inventoryAlerts?: Array<{ agentId: string; agentName: string; kind: string; message: string }>;
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

export function Section({
  title,
  children,
  action,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <section
      style={{
        background: 'var(--sd-panel)',
        border: '1px solid var(--sd-border)',
        borderRadius: 12,
        padding: 16,
        boxShadow: 'var(--sd-shadow)',
        gridColumn: wide ? '1 / -1' : undefined,
      }}
    >
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
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPageSize(readHistoryPageSize());
  }, []);

  useEffect(() => {
    window.localStorage.setItem(HISTORY_PAGE_SIZE_KEY, String(pageSize));
  }, [pageSize]);

  const historyTotal = data.history.length;
  const pageCount = Math.max(1, Math.ceil(historyTotal / pageSize) || 1);
  const safePage = Math.min(page, pageCount - 1);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  const historySlice = useMemo(() => {
    const start = safePage * pageSize;
    return data.history.slice(start, start + pageSize);
  }, [data.history, safePage, pageSize]);

  const showingFrom = historyTotal === 0 ? 0 : safePage * pageSize + 1;
  const showingTo = Math.min((safePage + 1) * pageSize, historyTotal);

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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 16 }}>
      {error && <p style={{ color: 'var(--sd-danger)', margin: 0, gridColumn: '1 / -1' }}>{error}</p>}

      <Section
        title={t('dashboard.attention')}
        action={<Link href="/runs" style={{ fontSize: 13, color: 'var(--sd-muted)' }}>{t('dashboard.viewRuns')}</Link>}
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
              flowName={a.flowName || t('runs.runFallback', { id: a.id.slice(0, 8) })}
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
                r.triggerSource ? tt(t, 'trigger', r.triggerSource) : null,
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
        title={t('dashboard.inventory')}
        action={<Link href="/agents" style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dashboard.viewAgents')}</Link>}
      >
        {(data.inventoryAlerts?.length || 0) === 0 && data.agents.length === 0 && (
          <Empty>{t('dashboard.noAgents')}</Empty>
        )}
        {(data.inventoryAlerts?.length || 0) === 0 && data.agents.length > 0 && (
          <Empty>{t('dashboard.noInventoryAlerts')}</Empty>
        )}
        {(data.inventoryAlerts || []).map((a) => (
          <div key={`${a.agentId}-${a.kind}`} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
            <strong>{a.agentName}</strong>
            <span style={{ color: 'var(--warn)', marginLeft: 8 }}>{a.message}</span>
          </div>
        ))}
        {data.agents.map((a) => {
          const inv = a.inventory;
          if (!inv) return null;
          const parts = [
            inv.containers != null ? `${inv.containers} ${t('dashboard.containersCount')}` : null,
            inv.danglingImages != null ? `${inv.danglingImages} ${t('dashboard.danglingImages')}` : null,
            inv.diskUsedBytes != null && inv.diskTotalBytes
              ? `${t('dashboard.diskUsage')} ${Math.round((inv.diskUsedBytes / inv.diskTotalBytes) * 100)}%`
              : inv.diskUsedBytes != null
                ? `${t('dashboard.diskUsage')} ${(inv.diskUsedBytes / (1024 ** 3)).toFixed(1)} GiB`
                : null,
            a.labels?.length ? a.labels.join(', ') : null,
          ].filter(Boolean);
          if (!parts.length) return null;
          return (
            <div key={a.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--muted)' }}>
              <strong style={{ color: 'var(--text)' }}>{a.name}</strong>
              {a.online ? '' : ` · ${tt(t, 'status', a.status || 'offline')}`}
              {' · '}
              {parts.join(' · ')}
            </div>
          );
        })}
      </Section>

      <Section
        wide
        title={t('dashboard.recentHistory')}
        action={(
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--sd-muted)' }}>
              {t('dashboard.historyPageSize')}
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
                className="sd-select"
                style={{ width: 'auto', minHeight: 32, padding: '4px 8px', fontSize: 13 }}
              >
                {HISTORY_PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <Link href="/runs" style={{ fontSize: 13, color: 'var(--muted)' }}>{t('dashboard.viewRuns')}</Link>
          </div>
        )}
      >
        {historyTotal === 0 && <Empty>{t('runs.emptyHistory')}</Empty>}
        {historySlice.map((r) => (
          <RunDashRow
            key={r.id}
            id={r.id}
            flowName={r.flowName}
            status={r.status}
            meta={[
              r.triggerSource ? tt(t, 'trigger', r.triggerSource) : null,
              formatDate(r.finishedAt || r.startedAt || null),
              r.context?.containerName,
            ].filter(Boolean).join(' · ')}
            busy={busyId === r.id}
            onRerun={() => { void rerun(r.id); }}
          />
        ))}
        {historyTotal > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            paddingTop: 8,
            marginTop: 4,
          }}
          >
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t('dashboard.historyShowing', { from: showingFrom, to: showingTo, total: historyTotal })}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                disabled={safePage <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '4px 10px',
                  cursor: safePage <= 0 ? 'default' : 'pointer',
                  opacity: safePage <= 0 ? 0.4 : 1,
                  color: 'inherit',
                  fontSize: 13,
                }}
              >
                {t('dashboard.historyPrev')}
              </button>
              <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 90, textAlign: 'center' }}>
                {t('dashboard.historyPage', { page: safePage + 1, total: pageCount })}
              </span>
              <button
                type="button"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '4px 10px',
                  cursor: safePage >= pageCount - 1 ? 'default' : 'pointer',
                  opacity: safePage >= pageCount - 1 ? 0.4 : 1,
                  color: 'inherit',
                  fontSize: 13,
                }}
              >
                {t('dashboard.historyNext')}
              </button>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
