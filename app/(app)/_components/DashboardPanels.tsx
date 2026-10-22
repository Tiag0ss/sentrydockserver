'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import { Panel, Button } from '@/components/ui';
import { IconButton, IconOpen, IconRefresh } from '@/components/IconActions';
import {
  AgentContainersPanel,
  type ContainerMetricsView,
} from '@/components/AgentContainersPanel';

export type DashboardData = {
  activeRuns: Array<{
    id: string;
    flowId: string;
    flowName: string;
    status: string;
    currentNodeId: string | null;
    currentNodeType?: string | null;
    currentNodeLabel?: string | null;
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
    currentNodeLabel?: string | null;
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
    metricsIntervalSec?: number;
    metricsRetentionHours?: number;
    containerMetrics?: ContainerMetricsView[];
  }>;
  inventoryAlerts?: Array<{ agentId: string; agentName: string; kind: string; message: string }>;
  pendingUpdates: Array<{ id: string; image: string; status: string }>;
  attention: Array<{
    id: string;
    flowName?: string;
    status: string;
    currentNodeId?: string | null;
    currentNodeType?: string | null;
    currentNodeLabel?: string | null;
    context?: {
      containerName?: string;
      image?: string;
      targets?: Array<{ containerName?: string }>;
      targetsCount?: number;
    } | null;
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
  currentNodeLabel?: string | null,
): string | null {
  const custom = String(currentNodeLabel || '').trim();
  const type = currentNodeType
    || (currentNodeId ? currentNodeId.match(/^([a-z][a-z0-9_]*)-/i)?.[1] : null);
  if (custom && custom !== type) return custom;
  if (!type) return custom || null;
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

function formatRelative(
  value: string | Date | null | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (!value) return '—';
  const ts = typeof value === 'string' ? Date.parse(value) : value.getTime();
  if (Number.isNaN(ts)) return '—';
  const diffSec = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const past = diffSec < 0;

  let unit: 'second' | 'minute' | 'hour' | 'day';
  let n: number;
  if (abs < 60) {
    unit = 'second';
    n = abs;
  } else if (abs < 3600) {
    unit = 'minute';
    n = Math.round(abs / 60);
  } else if (abs < 86400) {
    unit = 'hour';
    n = Math.round(abs / 3600);
  } else {
    unit = 'day';
    n = Math.round(abs / 86400);
  }

  const key = past
    ? `dashboard.relPast_${unit}`
    : `dashboard.relFuture_${unit}`;
  return t(key, { n });
}

function diskPct(inv: { diskUsedBytes?: number | null; diskTotalBytes?: number | null } | null | undefined): number | null {
  if (!inv?.diskUsedBytes || !inv.diskTotalBytes || inv.diskTotalBytes <= 0) return null;
  return Math.min(100, Math.round((inv.diskUsedBytes / inv.diskTotalBytes) * 100));
}

function ApproveButton({ id, onDone }: { id: string; onDone: () => void }) {
  const { t } = useI18n();
  return (
    <Button
      className="sd-btn-sm"
      onClick={async () => {
        await api(`/update-events/${id}/approve`, { method: 'POST', body: '{}' });
        onDone();
      }}
    >
      {t('dashboard.approve')}
    </Button>
  );
}

async function continueRun(runId: string, ok: boolean) {
  await api(`/runs/${runId}/continue`, {
    method: 'POST',
    body: JSON.stringify({ continue: ok }),
  });
}

function RunApprovalActions({
  runId,
  status,
  busy,
  onBusy,
  onDone,
  onError,
}: {
  runId: string;
  status: string;
  busy: boolean;
  onBusy: (id: string | null) => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const { t } = useI18n();
  if (status !== 'waiting_approval' && status !== 'awaiting_user') return null;
  const isApproval = status === 'waiting_approval';

  async function act(ok: boolean) {
    onBusy(runId);
    onError('');
    try {
      await continueRun(runId, ok);
      onDone();
    } catch (e) {
      onError(e instanceof Error ? e.message : t('runs.actionError'));
    } finally {
      onBusy(null);
    }
  }

  return (
    <>
      <Button
        className="sd-btn-sm"
        disabled={busy}
        onClick={() => { void act(true); }}
      >
        {isApproval ? t('runs.approve') : t('runs.continue')}
      </Button>
      <Button
        variant="danger"
        className="sd-btn-sm"
        disabled={busy}
        onClick={() => { void act(false); }}
      >
        {isApproval ? t('runs.reject') : t('runs.abort')}
      </Button>
    </>
  );
}

export function DashboardPanels({ data, onReload }: { data: DashboardData; onReload: () => void }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const needsAttention = data.attention.length > 0 || data.pendingUpdates.length > 0;
  const UPCOMING_PAGE_SIZES = [5, 8, 12] as const;
  const [upcomingPage, setUpcomingPage] = useState(1);
  const [upcomingPageSize, setUpcomingPageSize] = useState<(typeof UPCOMING_PAGE_SIZES)[number]>(8);
  const upcomingTotal = data.upcomingPolicies.length;
  const upcomingTotalPages = Math.max(1, Math.ceil(upcomingTotal / upcomingPageSize));
  const upcomingPageSafe = Math.min(upcomingPage, upcomingTotalPages);
  const upcoming = data.upcomingPolicies.slice(
    (upcomingPageSafe - 1) * upcomingPageSize,
    upcomingPageSafe * upcomingPageSize,
  );

  const recentFailures = useMemo(
    () => data.history
      .filter((r) => r.status === 'failed' || r.status === 'aborted' || r.status === 'rejected')
      .slice(0, 5),
    [data.history],
  );

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
      {error ? <p className="sd-dash-error">{error}</p> : null}

      <div className="sd-dash-grid">
        <section className="sd-dash-col sd-dash-col-main">
          <div className="sd-section-head">
            <div>
              <h2>{t('dashboard.inbox')}</h2>
              <p>{needsAttention ? t('dashboard.inboxHintBusy') : t('dashboard.inboxHintOk')}</p>
            </div>
          </div>

          {!needsAttention ? (
            <Panel className="sd-entity-card sd-dash-ok">
              <div className="sd-entity-item">
                <div className="sd-entity-main">
                  <div className="sd-entity-top">
                    <strong className="sd-entity-name">{t('dashboard.inboxEmpty')}</strong>
                  </div>
                  <div className="sd-entity-meta">{t('dashboard.inboxEmptyHint')}</div>
                </div>
              </div>
            </Panel>
          ) : (
            <div className="sd-entity-list">
              {data.pendingUpdates.map((u) => (
                <Panel key={u.id} className="sd-entity-card">
                  <div className="sd-entity-item">
                    <div className="sd-entity-main">
                      <div className="sd-entity-top">
                        <strong className="sd-entity-name">{t('dashboard.update')}: {u.image}</strong>
                        <span className="sd-entity-badge" style={{ color: 'var(--sd-warn)' }}>
                          {t('dashboard.pendingUpdates')}
                        </span>
                      </div>
                    </div>
                    <div className="sd-entity-actions">
                      <ApproveButton id={u.id} onDone={onReload} />
                    </div>
                  </div>
                </Panel>
              ))}
              {data.attention.map((a) => {
                const step = humanStepLabel(t, a.currentNodeType, a.currentNodeId, a.currentNodeLabel);
                const targetsCount = Array.isArray(a.context?.targets)
                  ? a.context!.targets!.length
                  : (typeof a.context?.targetsCount === 'number' ? a.context.targetsCount : null);
                const targetsPreview = Array.isArray(a.context?.targets)
                  ? a.context!.targets!
                    .map((x) => x.containerName)
                    .filter(Boolean)
                    .slice(0, 3)
                    .join(', ')
                  : null;
                const busy = busyId === a.id;
                return (
                  <Panel key={a.id} className="sd-entity-card">
                    <div className="sd-entity-item">
                      <div className="sd-entity-main">
                        <div className="sd-entity-top">
                          <strong className="sd-entity-name">
                            {a.flowName || t('runs.runFallback', { id: a.id.slice(0, 8) })}
                          </strong>
                          <span className="sd-entity-status" style={{ color: runStatusColor(a.status) }}>
                            {tt(t, 'status', a.status)}
                          </span>
                        </div>
                        <div className="sd-entity-meta">
                          {[
                            t('dashboard.needsAction'),
                            step ? `${t('dashboard.step')}: ${step}` : null,
                            targetsCount != null ? `${targetsCount} ${t('dashboard.containersCount')}` : null,
                            targetsPreview || a.context?.containerName,
                            a.context?.image,
                          ].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div className="sd-entity-actions">
                        <RunApprovalActions
                          runId={a.id}
                          status={a.status}
                          busy={busy || (busyId !== null && busyId !== a.id)}
                          onBusy={setBusyId}
                          onDone={onReload}
                          onError={setError}
                        />
                        <IconButton label={t('runs.openDetail')} onClick={() => router.push(`/runs/${a.id}`)}>
                          <IconOpen />
                        </IconButton>
                      </div>
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
        </section>

        <section className="sd-dash-col">
          <div className="sd-section-head">
            <div>
              <h2>{t('dashboard.upcoming')}</h2>
              <p>{t('dashboard.upcomingHint')}</p>
            </div>
            <Link href="/flows" className="sd-entity-link">{t('dashboard.viewFlows')}</Link>
          </div>
          {upcomingTotal === 0 ? (
            <Panel className="sd-entity-card">
              <div className="sd-entity-meta" style={{ marginTop: 0 }}>{t('dashboard.noUpcoming')}</div>
            </Panel>
          ) : (
            <>
              <div className="sd-entity-list">
                {upcoming.map((p) => (
                  <Panel key={p.id} className="sd-entity-card">
                    <div className="sd-entity-item">
                      <div className="sd-entity-main">
                        <div className="sd-entity-top">
                          <strong className="sd-entity-name">{p.name}</strong>
                          <span className="sd-entity-badge" style={{ color: 'var(--sd-accent)' }}>
                            {formatRelative(p.nextRunAt, t)}
                          </span>
                        </div>
                        <div className="sd-entity-meta">
                          {p.cron} ({p.timezone}) · {formatDate(p.nextRunAt)}
                        </div>
                      </div>
                    </div>
                  </Panel>
                ))}
              </div>
              {upcomingTotal > UPCOMING_PAGE_SIZES[0] ? (
                <div className="sd-logs-filter-meta" style={{ marginTop: 10 }}>
                  <span className="sd-entity-muted">
                    {t('dashboard.upcomingPage', {
                      page: String(upcomingPageSafe),
                      total: String(upcomingTotalPages),
                    })}
                  </span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--sd-muted)' }}>
                      {t('dashboard.upcomingPageSize')}
                      <select
                        className="sd-input sd-input-sm"
                        value={upcomingPageSize}
                        onChange={(e) => {
                          setUpcomingPageSize(Number(e.target.value) as (typeof UPCOMING_PAGE_SIZES)[number]);
                          setUpcomingPage(1);
                        }}
                      >
                        {UPCOMING_PAGE_SIZES.map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                    <Button
                      variant="ghost"
                      className="sd-btn-sm"
                      disabled={upcomingPageSafe <= 1}
                      onClick={() => setUpcomingPage((p) => Math.max(1, p - 1))}
                    >
                      {t('dashboard.upcomingPrev')}
                    </Button>
                    <Button
                      variant="ghost"
                      className="sd-btn-sm"
                      disabled={upcomingPageSafe >= upcomingTotalPages}
                      onClick={() => setUpcomingPage((p) => Math.min(upcomingTotalPages, p + 1))}
                    >
                      {t('dashboard.upcomingNext')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>

      <div className="sd-section-head" style={{ marginTop: 4 }}>
        <div>
          <h2>{t('dashboard.fleet')}</h2>
          <p>{t('dashboard.fleetHint')}</p>
        </div>
        <Link href="/agents" className="sd-entity-link">{t('dashboard.viewAgents')}</Link>
      </div>

      {(data.inventoryAlerts?.length || 0) > 0 ? (
        <div className="sd-entity-list" style={{ marginBottom: 8 }}>
          {(data.inventoryAlerts || []).map((a) => (
            <Panel key={`${a.agentId}-${a.kind}`} className="sd-entity-card sd-dash-alert">
              <div className="sd-entity-item">
                <div className="sd-entity-main">
                  <div className="sd-entity-top">
                    <strong className="sd-entity-name">{a.agentName}</strong>
                    <span className="sd-entity-badge" style={{ color: 'var(--sd-warn)' }}>{a.message}</span>
                  </div>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      ) : null}

      {data.agents.length === 0 ? (
        <Panel className="sd-entity-card">
          <div className="sd-entity-meta" style={{ marginTop: 0 }}>{t('dashboard.noAgents')}</div>
        </Panel>
      ) : (
        <div className="sd-dash-fleet">
          {data.agents.map((a) => {
            const inv = a.inventory;
            const pct = diskPct(inv);
            return (
              <Link
                key={a.id}
                href={`/agents/${a.id}`}
                className="sd-dash-agent-link"
                aria-label={a.name}
              >
                <Panel className="sd-entity-card sd-dash-agent">
                  <div className="sd-entity-top">
                    <strong className="sd-entity-name">{a.name}</strong>
                    <span
                      className="sd-entity-status"
                      style={{ color: a.online ? 'var(--sd-ok)' : 'var(--sd-muted)' }}
                    >
                      {a.online ? t('agents.online') : t('agents.offline')}
                    </span>
                  </div>
                  <div className="sd-entity-meta sd-entity-meta-wrap">
                    {[
                      inv?.containers != null ? `${inv.containers} ${t('dashboard.containersCount')}` : null,
                      inv?.danglingImages != null ? `${inv.danglingImages} ${t('dashboard.danglingImages')}` : null,
                      a.labels?.length ? a.labels.join(', ') : null,
                    ].filter(Boolean).join(' · ') || t('dashboard.noInventoryData')}
                  </div>
                  {pct != null ? (
                    <div className="sd-meter" title={`${t('dashboard.diskUsage')} ${pct}%`}>
                      <div className="sd-meter-label">
                        <span>{t('dashboard.diskUsage')}</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="sd-meter-track">
                        <div
                          className={`sd-meter-fill${pct >= 85 ? ' sd-meter-fill-warn' : ''}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </Panel>
              </Link>
            );
          })}
        </div>
      )}

      <div className="sd-section-head" style={{ marginTop: 4 }}>
        <div>
          <h2>{t('dashboard.containersByAgent')}</h2>
          <p>{t('dashboard.containersByAgentHint')}</p>
        </div>
      </div>
      {data.agents.length === 0 ? (
        <Panel className="sd-entity-card">
          <div className="sd-entity-meta" style={{ marginTop: 0 }}>{t('dashboard.noAgents')}</div>
        </Panel>
      ) : (
        <div className="sd-dash-agent-metrics">
          {data.agents.map((a) => (
            <div key={`metrics-${a.id}`}>
              <AgentContainersPanel
                agentId={a.id}
                agentName={a.name}
                online={a.online}
                initialContainers={a.containerMetrics}
                pollMs={Math.max(10_000, (a.metricsIntervalSec || 30) * 1000)}
                compact
              />
            </div>
          ))}
        </div>
      )}

      <div className="sd-section-head" style={{ marginTop: 4 }}>
        <div>
          <h2>{t('dashboard.recentFailures')}</h2>
          <p>{t('dashboard.recentFailuresHint')}</p>
        </div>
        <Link href="/runs" className="sd-entity-link">{t('dashboard.viewRuns')}</Link>
      </div>
      {recentFailures.length === 0 ? (
        <Panel className="sd-entity-card">
          <div className="sd-entity-meta" style={{ marginTop: 0 }}>{t('dashboard.noRecentFailures')}</div>
        </Panel>
      ) : (
        <div className="sd-entity-list">
          {recentFailures.map((r) => (
            <Panel key={r.id} className="sd-entity-card">
              <div className="sd-entity-item">
                <div className="sd-entity-main">
                  <div className="sd-entity-top">
                    <strong className="sd-entity-name">{r.flowName}</strong>
                    <span className="sd-entity-status" style={{ color: runStatusColor(r.status) }}>
                      {tt(t, 'status', r.status)}
                    </span>
                  </div>
                  <div className="sd-entity-meta">
                    {[
                      r.triggerSource ? tt(t, 'trigger', r.triggerSource) : null,
                      formatDate(r.finishedAt || r.startedAt || null),
                      r.context?.containerName,
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="sd-entity-actions">
                  <IconButton label={t('runs.openDetail')} onClick={() => router.push(`/runs/${r.id}`)}>
                    <IconOpen />
                  </IconButton>
                  <IconButton
                    label={t('runs.rerun')}
                    tone="primary"
                    disabled={busyId === r.id || (busyId !== null && busyId !== r.id)}
                    onClick={() => { void rerun(r.id); }}
                  >
                    <IconRefresh />
                  </IconButton>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
