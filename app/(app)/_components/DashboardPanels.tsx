'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import { Panel, Button } from '@/components/ui';
import { IconButton, IconOpen, IconRefresh } from '@/components/IconActions';

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

export function DashboardPanels({ data, onReload }: { data: DashboardData; onReload: () => void }) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const needsAttention = data.attention.length > 0 || data.pendingUpdates.length > 0;
  const upcoming = data.upcomingPolicies.slice(0, 8);

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
                const step = humanStepLabel(t, a.currentNodeType, a.currentNodeId);
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
                            a.context?.containerName,
                          ].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div className="sd-entity-actions">
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
            <Link href="/policies" className="sd-entity-link">{t('dashboard.viewPolicies')}</Link>
          </div>
          {upcoming.length === 0 ? (
            <Panel className="sd-entity-card">
              <div className="sd-entity-meta" style={{ marginTop: 0 }}>{t('dashboard.noPolicies')}</div>
            </Panel>
          ) : (
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
              <Panel key={a.id} className="sd-entity-card sd-dash-agent">
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
            );
          })}
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
