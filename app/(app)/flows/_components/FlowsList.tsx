'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import { PageHeader, Button, Alert, EmptyState, Panel, Input } from '@/components/ui';
import {
  IconButton, IconPlay, IconEdit, IconCopy, IconTrash,
} from '@/components/IconActions';

export type FlowSummary = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  graph: { nodes: unknown[]; edges: unknown[] };
  lastRun?: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt?: string | null;
    dryRun?: boolean;
  } | null;
  nextRun?: {
    at: string;
    policyId: string;
    policyName?: string | null;
  } | null;
};

type Props = {
  onCreate: () => void;
  onEdit: (flow: FlowSummary) => void;
};

function runStatusColor(status: string): string {
  if (status === 'success') return '#3dd68c';
  if (status === 'failed' || status === 'aborted' || status === 'rejected') return 'var(--sd-danger)';
  if (status === 'running') return 'var(--sd-accent)';
  if (status === 'waiting_approval' || status === 'awaiting_user' || status === 'interrupted') return 'var(--sd-warn)';
  return 'var(--sd-muted)';
}

export function FlowsList({ onCreate, onEdit }: Props) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [runningId, setRunningId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setFlows(await api<FlowSummary[]>('/flows'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('flows.loadError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flows;
    return flows.filter((f) => {
      const name = f.name.toLowerCase();
      const desc = (f.description || '').toLowerCase();
      const id = f.id.toLowerCase();
      const status = (f.lastRun?.status || '').toLowerCase();
      return name.includes(q) || desc.includes(q) || id.includes(q) || status.includes(q);
    });
  }, [flows, query]);

  async function remove(id: string, name: string) {
    if (!window.confirm(t('flows.deleteConfirm', { name }))) return;
    await api(`/flows/${id}`, { method: 'DELETE' });
    await load();
  }

  async function duplicate(id: string) {
    await api(`/flows/${id}/duplicate`, { method: 'POST' });
    await load();
  }

  async function runFlow(id: string) {
    setRunningId(id);
    setError('');
    try {
      const res = await api<{ runId: string }>(`/flows/${id}/run`, {
        method: 'POST',
        body: JSON.stringify({ dryRun: false }),
      });
      router.push(`/runs/${res.runId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('flows.runError'));
      setRunningId(null);
    }
  }

  return (
    <div className="sd-page sd-page-compact">
      <PageHeader
        title={t('flows.title')}
        subtitle={t('flows.subtitle')}
        actions={<Button onClick={onCreate}>{t('flows.new')}</Button>}
      />

      {!loading && flows.length > 0 ? (
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('flows.search')}
          aria-label={t('flows.search')}
          className="sd-input sd-input-sm"
          style={{ maxWidth: 320 }}
        />
      ) : null}

      {loading ? <p style={{ color: 'var(--sd-muted)', margin: 0, fontSize: 13 }}>{t('flows.loading')}</p> : null}
      {error ? <Alert>{error}</Alert> : null}

      {!loading && !error && flows.length === 0 ? (
        <EmptyState>{t('flows.empty')}</EmptyState>
      ) : null}

      {!loading && flows.length > 0 && filtered.length === 0 ? (
        <EmptyState>{t('flows.searchEmpty')}</EmptyState>
      ) : null}

      {filtered.length > 0 ? (
        <div className="sd-flows-list">
          {filtered.map((f) => {
            const nodeCount = f.graph?.nodes?.length ?? 0;
            const edgeCount = f.graph?.edges?.length ?? 0;
            const last = f.lastRun;
            const next = f.nextRun;
            const busy = runningId === f.id;
            return (
              <Panel key={f.id} className="sd-flow-card">
                <div className="sd-flow-item">
                  <div className="sd-flow-item-main">
                    <div className="sd-flow-item-top">
                      <strong className="sd-flow-item-name">{f.name}</strong>
                      {last ? (
                        <>
                          <span
                            className="sd-flow-run-status"
                            style={{ color: runStatusColor(last.status) }}
                          >
                            {tt(t, 'status', last.status)}
                          </span>
                          {last.dryRun ? (
                            <span className="sd-flow-dry">{t('runs.dryRunBadge')}</span>
                          ) : null}
                          <Link href={`/runs/${last.id}`} className="sd-flow-run-link">
                            {formatDate(last.finishedAt || last.startedAt)}
                          </Link>
                        </>
                      ) : (
                        <span className="sd-flow-run-none">{t('flows.noLastRun')}</span>
                      )}
                      <span className="sd-flow-sep">·</span>
                      {next ? (
                        <span className="sd-flow-next">
                          {t('flows.nextRun')} {formatDate(next.at)}
                        </span>
                      ) : (
                        <span className="sd-flow-run-none">{t('flows.noNextRun')}</span>
                      )}
                    </div>
                    <div className="sd-flow-item-meta">
                      {f.description || t('flows.noDescription')}
                      {' · '}
                      {nodeCount} {t('flows.nodes')}
                      {' · '}
                      {edgeCount} {t('flows.edges')}
                      {' · '}
                      {t('flows.updated')} {formatDate(f.updatedAt)}
                    </div>
                  </div>
                  <div className="sd-flow-item-actions">
                    <IconButton
                      label={busy ? t('flows.running') : t('flows.run')}
                      tone="primary"
                      disabled={busy || Boolean(runningId)}
                      onClick={() => { void runFlow(f.id); }}
                    >
                      <IconPlay />
                    </IconButton>
                    <IconButton label={t('flows.edit')} onClick={() => onEdit(f)}>
                      <IconEdit />
                    </IconButton>
                    <IconButton label={t('flows.duplicate')} onClick={() => { void duplicate(f.id); }}>
                      <IconCopy />
                    </IconButton>
                    <IconButton
                      label={t('flows.delete')}
                      tone="danger"
                      onClick={() => { void remove(f.id, f.name); }}
                    >
                      <IconTrash />
                    </IconButton>
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
