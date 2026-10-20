'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { io } from 'socket.io-client';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { Alert, EmptyState, Button, Panel } from '@/components/ui';
import { IconButton, IconPlay, IconStop, IconRefresh } from '@/components/IconActions';
import { MetricSparkline } from '@/components/MetricSparkline';

export type MetricPoint = {
  ts: number;
  cpuPercent: number | null;
  memoryUsageBytes: number | null;
  memoryLimitBytes: number | null;
  sizeRwBytes: number | null;
  sizeRootFsBytes: number | null;
};

export type ContainerMetricsView = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  stats: {
    cpuPercent: number | null;
    memoryUsageBytes: number | null;
    memoryLimitBytes: number | null;
    sizeRwBytes: number | null;
    sizeRootFsBytes: number | null;
  };
  series: MetricPoint[];
};

export type AgentMetricsResponse = {
  agentId: string;
  agentName: string;
  online: boolean;
  config: { metricsIntervalSec: number; metricsRetentionHours: number };
  containers: ContainerMetricsView[];
  from: number;
  to: number;
};

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function formatCpu(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(n >= 10 ? 0 : 1)}%`;
}

function formatMem(usage: number | null | undefined, limit: number | null | undefined): string {
  if (usage == null) return '—';
  if (limit != null && limit > 0 && limit < 1e15) {
    return `${formatBytes(usage)} / ${formatBytes(limit)}`;
  }
  return formatBytes(usage);
}

function stateColor(state: string): string {
  const s = state.toLowerCase();
  if (s === 'running') return '#3dd68c';
  if (s === 'exited' || s === 'dead') return 'var(--sd-danger)';
  if (s === 'paused' || s === 'restarting') return 'var(--sd-warn)';
  return 'var(--sd-muted)';
}

export function AgentContainersPanel({
  agentId,
  agentName,
  online,
  initialContainers,
  pollMs = 10_000,
  showHeader = true,
  compact = false,
}: {
  agentId: string;
  agentName?: string;
  online?: boolean;
  initialContainers?: ContainerMetricsView[];
  /** UI refresh interval (server retains history from agent samples). */
  pollMs?: number;
  showHeader?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [containers, setContainers] = useState<ContainerMetricsView[]>(initialContainers || []);
  const [isOnline, setIsOnline] = useState(Boolean(online));
  const [loading, setLoading] = useState(!initialContainers);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [title, setTitle] = useState(agentName || '');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await api<AgentMetricsResponse>(`/agents/${agentId}/metrics`);
      setContainers(data.containers || []);
      setIsOnline(Boolean(data.online));
      if (data.agentName) setTitle(data.agentName);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [agentId, t]);

  useEffect(() => {
    if (online != null) setIsOnline(Boolean(online));
  }, [online]);

  useEffect(() => {
    if (agentName) setTitle(agentName);
  }, [agentName]);

  useEffect(() => {
    void load();

    const socket = io('/ui', { path: '/socket.io' });
    socket.on('metrics:updated', (payload: AgentMetricsResponse & { agentId?: string }) => {
      if (!payload || payload.agentId !== agentId) return;
      setContainers(payload.containers || []);
      setIsOnline(Boolean(payload.online));
      if (payload.agentName) setTitle(payload.agentName);
      setError('');
      setLoading(false);
    });

    // Slow fallback if WS is down; live path is metrics:updated from agent samples.
    const fallbackMs = Math.max(pollMs, 60_000);
    const timer = setInterval(() => { void load(true); }, fallbackMs);

    return () => {
      socket.close();
      clearInterval(timer);
    };
  }, [load, pollMs, agentId]);

  async function control(cid: string, action: 'start' | 'stop' | 'restart') {
    setBusyId(cid);
    setError('');
    try {
      await api(`/agents/${agentId}/containers/${encodeURIComponent(cid)}/${action}`, {
        method: 'POST',
        body: '{}',
      });
      await load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('agents.actionFailed'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={`sd-agent-containers-panel${compact ? ' sd-agent-containers-panel-compact' : ''}`}>
      {showHeader ? (
        <div className="sd-agent-containers-head">
          <div>
            <Link href={`/agents/${agentId}`} className="sd-agent-containers-title sd-entity-link">
              {title || agentName || agentId.slice(0, 8)}
            </Link>
            <span
              className="sd-agent-containers-online"
              style={{ color: isOnline ? '#3dd68c' : 'var(--sd-muted)' }}
            >
              {isOnline ? t('agents.online') : t('agents.offline')}
            </span>
          </div>
          <Button variant="ghost" className="sd-btn-sm" disabled={loading} onClick={() => { void load(); }}>
            {loading ? t('agents.containersLoading') : t('agents.containersRefresh')}
          </Button>
        </div>
      ) : null}

      {error ? <Alert>{error}</Alert> : null}

      {loading && containers.length === 0 ? (
        <div className="sd-entity-muted">{t('agents.containersLoading')}</div>
      ) : null}

      {!loading && containers.length === 0 && !error ? (
        <EmptyState>{t('agents.containersEmpty')}</EmptyState>
      ) : null}

      {containers.length > 0 ? (
        <div className="sd-container-cards">
          {containers.map((c) => {
            const running = String(c.state || '').toLowerCase() === 'running';
            const busy = busyId === c.id;
            const size = c.stats?.sizeRwBytes ?? c.stats?.sizeRootFsBytes ?? null;
            return (
              <Panel key={c.id} className="sd-entity-card sd-container-card">
                <div className="sd-container-card-top">
                  <div className="sd-container-card-names">
                    <strong className="sd-secret-name" title={c.name}>{c.name}</strong>
                    <span style={{ color: stateColor(c.state), fontSize: 12, fontWeight: 600 }}>
                      {c.state || '—'}
                    </span>
                  </div>
                  <div className="sd-entity-actions">
                    {running ? (
                      <>
                        <IconButton
                          label={busy ? t('agents.actionBusy') : t('agents.stop')}
                          tone="danger"
                          disabled={busy || !isOnline}
                          onClick={() => { void control(c.id, 'stop'); }}
                        >
                          <IconStop />
                        </IconButton>
                        <IconButton
                          label={busy ? t('agents.actionBusy') : t('agents.restart')}
                          disabled={busy || !isOnline}
                          onClick={() => { void control(c.id, 'restart'); }}
                        >
                          <IconRefresh />
                        </IconButton>
                      </>
                    ) : (
                      <IconButton
                        label={busy ? t('agents.actionBusy') : t('agents.start')}
                        tone="primary"
                        disabled={busy || !isOnline}
                        onClick={() => { void control(c.id, 'start'); }}
                      >
                        <IconPlay />
                      </IconButton>
                    )}
                  </div>
                </div>

                <div className="sd-entity-muted sd-container-card-image" title={c.image}>
                  {c.image || '—'}
                </div>
                <div className="sd-entity-muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {c.status}
                </div>

                <div className="sd-container-card-stats">
                  <div>
                    <div className="sd-entity-muted">{t('agents.colCpu')}</div>
                    <strong>{formatCpu(c.stats?.cpuPercent)}</strong>
                  </div>
                  <div>
                    <div className="sd-entity-muted">{t('agents.colMem')}</div>
                    <strong>{formatMem(c.stats?.memoryUsageBytes, c.stats?.memoryLimitBytes)}</strong>
                  </div>
                  <div>
                    <div className="sd-entity-muted">{t('agents.colSize')}</div>
                    <strong>{formatBytes(size)}</strong>
                  </div>
                </div>

                <div className="sd-container-card-charts">
                  <div>
                    <div className="sd-entity-muted" style={{ fontSize: 10, marginBottom: 2 }}>{t('agents.colCpu')}</div>
                    <MetricSparkline
                      width={compact ? 110 : 130}
                      height={32}
                      points={c.series.map((p) => ({ ts: p.ts, value: p.cpuPercent }))}
                      color="#5b9fd4"
                    />
                  </div>
                  <div>
                    <div className="sd-entity-muted" style={{ fontSize: 10, marginBottom: 2 }}>{t('agents.colMem')}</div>
                    <MetricSparkline
                      width={compact ? 110 : 130}
                      height={32}
                      points={c.series.map((p) => ({ ts: p.ts, value: p.memoryUsageBytes }))}
                      color="#3dd68c"
                    />
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
