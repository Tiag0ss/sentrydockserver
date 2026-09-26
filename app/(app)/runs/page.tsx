'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import {
  PageHeader, Alert, EmptyState, Panel, Button, Input, Select, Field,
} from '@/components/ui';
import { IconButton, IconOpen, IconRefresh } from '@/components/IconActions';

type Run = {
  id: string;
  flowId: string;
  flowName: string;
  status: string;
  currentNodeId: string | null;
  currentNodeType?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  triggerSource: string;
  dryRun?: boolean | number;
  parentRunId?: string | null;
  context?: {
    containerName?: string;
    agentId?: string;
    image?: string;
    targets?: Array<{ containerName?: string }>;
  } | null;
};

type HistoryResponse = {
  items: Run[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    flows: Array<{ id: string; name: string }>;
    statuses: string[];
    triggers: string[];
  };
};

const PAGE_SIZES = [10, 20, 50];

function contextHint(r: Run): string | null {
  const targets = Array.isArray(r.context?.targets)
    ? r.context!.targets!.map((x) => x.containerName).filter(Boolean).slice(0, 3).join(', ')
    : null;
  const parts = [targets || r.context?.containerName, r.context?.image].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function humanStepLabel(t: (key: string) => string, r: Run): string | null {
  const type = r.currentNodeType
    || (r.currentNodeId ? r.currentNodeId.match(/^([a-z][a-z0-9_]*)-/i)?.[1] : null);
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

export default function RunsPage() {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [active, setActive] = useState<Run[]>([]);
  const [history, setHistory] = useState<Run[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [facets, setFacets] = useState<HistoryResponse['facets']>({
    flows: [],
    statuses: [],
    triggers: [],
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [qDraft, setQDraft] = useState('');
  const [q, setQ] = useState('');
  const [flowId, setFlowId] = useState('');
  const [runStatus, setRunStatus] = useState('');
  const [trigger, setTrigger] = useState('');
  const [dryRun, setDryRun] = useState('');
  const [topLevelOnly, setTopLevelOnly] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setQ(qDraft), 280);
    return () => clearTimeout(timer);
  }, [qDraft]);

  // Reset to first page when filters change
  useEffect(() => {
    setPage(1);
  }, [q, flowId, runStatus, trigger, dryRun, topLevelOnly, pageSize]);

  const loadActive = useCallback(async () => {
    setActive(await api('/runs?status=active'));
  }, []);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const params = new URLSearchParams();
      params.set('status', 'history');
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (q.trim()) params.set('q', q.trim());
      if (flowId) params.set('flowId', flowId);
      if (runStatus) params.set('runStatus', runStatus);
      if (trigger) params.set('trigger', trigger);
      if (dryRun) params.set('dryRun', dryRun);
      if (topLevelOnly) params.set('topLevelOnly', '1');
      const data = await api<HistoryResponse>(`/runs?${params.toString()}`);
      setHistory(data.items || []);
      setTotal(Number(data.total || 0));
      setFacets(data.facets || { flows: [], statuses: [], triggers: [] });
    } finally {
      setLoadingHistory(false);
    }
  }, [page, pageSize, q, flowId, runStatus, trigger, dryRun, topLevelOnly]);

  const load = useCallback(async () => {
    setError('');
    try {
      await Promise.all([loadActive(), loadHistory()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    }
  }, [loadActive, loadHistory, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasFilters = Boolean(q || flowId || runStatus || trigger || dryRun || !topLevelOnly);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const showingLabel = useMemo(
    () => t('runs.historyShowing', { from: String(from), to: String(to), total: String(total) }),
    [t, from, to, total],
  );

  function clearFilters() {
    setQDraft('');
    setQ('');
    setFlowId('');
    setRunStatus('');
    setTrigger('');
    setDryRun('');
    setTopLevelOnly(true);
    setPage(1);
  }

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

  async function decide(runId: string, ok: boolean) {
    setBusyId(runId);
    setError('');
    try {
      await api(`/runs/${runId}/continue`, {
        method: 'POST',
        body: JSON.stringify({ continue: ok }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('runs.actionError'));
    } finally {
      setBusyId(null);
    }
  }

  function RunCard({ r, showStep }: { r: Run; showStep?: boolean }) {
    const hint = contextHint(r);
    const busy = busyId === r.id;
    const otherBusy = busyId !== null && !busy;
    const step = showStep ? humanStepLabel(t, r) : null;
    const needsDecision = r.status === 'waiting_approval' || r.status === 'awaiting_user';
    const isApproval = r.status === 'waiting_approval';
    return (
      <Panel className="sd-entity-card">
        <div className="sd-entity-item">
          <div className="sd-entity-main">
            <div className="sd-entity-top">
              <strong className="sd-entity-name">{r.flowName}</strong>
              <span className="sd-entity-status" style={{ color: runStatusColor(r.status) }}>
                {tt(t, 'status', r.status)}
              </span>
              {r.dryRun ? (
                <span className="sd-entity-badge" style={{ color: 'var(--sd-warn)' }}>{t('runs.dryRunBadge')}</span>
              ) : null}
              {r.parentRunId ? (
                <span className="sd-entity-badge">{t('runs.childBadge')}</span>
              ) : null}
            </div>
            <div className="sd-entity-meta">
              <span title={r.id}>{r.id.slice(0, 8)}…</span>
              {' · '}
              {tt(t, 'trigger', r.triggerSource)}
              {' · '}
              {formatDate(r.finishedAt || r.startedAt)}
              {hint ? <> · {hint}</> : null}
              {step ? <> · {t('runs.step')}: {step}</> : null}
            </div>
          </div>
          <div className="sd-entity-actions">
            {needsDecision ? (
              <>
                <Button
                  className="sd-btn-sm"
                  disabled={busy || otherBusy}
                  onClick={() => { void decide(r.id, true); }}
                >
                  {isApproval ? t('runs.approve') : t('runs.continue')}
                </Button>
                <Button
                  variant="danger"
                  className="sd-btn-sm"
                  disabled={busy || otherBusy}
                  onClick={() => { void decide(r.id, false); }}
                >
                  {isApproval ? t('runs.reject') : t('runs.abort')}
                </Button>
              </>
            ) : null}
            <IconButton label={t('runs.openDetail')} onClick={() => router.push(`/runs/${r.id}`)}>
              <IconOpen />
            </IconButton>
            <IconButton
              label={t('runs.rerun')}
              tone="primary"
              disabled={busy || otherBusy}
              onClick={() => { void rerun(r.id); }}
            >
              <IconRefresh />
            </IconButton>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <div className="sd-page sd-page-compact">
      <PageHeader
        title={t('runs.title')}
        subtitle={t('runs.subtitle')}
        actions={(
          <IconButton label={t('common.refresh')} onClick={() => { void load(); }}>
            <IconRefresh />
          </IconButton>
        )}
      />
      {error ? <Alert>{error}</Alert> : null}

      <div className="sd-section-head">
        <h2>{t('runs.active')}</h2>
      </div>
      {active.length === 0 ? <EmptyState>{t('runs.emptyActive')}</EmptyState> : (
        <div className="sd-entity-list">
          {active.map((r) => <RunCard key={r.id} r={r} showStep />)}
        </div>
      )}

      <div className="sd-section-head" style={{ marginTop: 8 }}>
        <h2>{t('runs.history')}</h2>
      </div>

      <Panel className="sd-logs-filters">
        <div className="sd-form-row">
          <Field label={t('runs.search')}>
            <Input
              value={qDraft}
              placeholder={t('runs.searchPlaceholder')}
              onChange={(e) => setQDraft(e.target.value)}
            />
          </Field>
          <Field label={t('runs.filterFlow')}>
            <Select value={flowId} onChange={(e) => setFlowId(e.target.value)}>
              <option value="">{t('runs.allFlows')}</option>
              {facets.flows.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('runs.filterStatus')}>
            <Select value={runStatus} onChange={(e) => setRunStatus(e.target.value)}>
              <option value="">{t('runs.allStatuses')}</option>
              {facets.statuses.map((s) => (
                <option key={s} value={s}>{tt(t, 'status', s)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('runs.filterTrigger')}>
            <Select value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              <option value="">{t('runs.allTriggers')}</option>
              {facets.triggers.map((tr) => (
                <option key={tr} value={tr}>{tt(t, 'trigger', tr) || tr}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('runs.filterDryRun')}>
            <Select value={dryRun} onChange={(e) => setDryRun(e.target.value)}>
              <option value="">{t('runs.allDryRun')}</option>
              <option value="0">{t('runs.realRuns')}</option>
              <option value="1">{t('runs.dryRunsOnly')}</option>
            </Select>
          </Field>
          <Field label={t('runs.filterScope')}>
            <Select
              value={topLevelOnly ? 'top' : 'all'}
              onChange={(e) => setTopLevelOnly(e.target.value === 'top')}
            >
              <option value="top">{t('runs.topLevelOnly')}</option>
              <option value="all">{t('runs.includeChildren')}</option>
            </Select>
          </Field>
        </div>
        <div className="sd-logs-filter-meta">
          <span className="sd-entity-muted">
            {loadingHistory ? t('common.loading') : showingLabel}
          </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--sd-muted)' }}>
                {t('runs.pageSize')}
                <Select
                  value={String(pageSize)}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </Select>
              </label>
              {hasFilters ? (
                <Button variant="ghost" className="sd-btn-sm" onClick={clearFilters}>
                  {t('runs.clearFilters')}
                </Button>
              ) : null}
            </div>
        </div>
      </Panel>

      {!loadingHistory && history.length === 0 ? (
        <EmptyState>{hasFilters ? t('runs.emptyFiltered') : t('runs.emptyHistory')}</EmptyState>
      ) : (
        <div className="sd-entity-list">
          {history.map((r) => <RunCard key={r.id} r={r} />)}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="sd-logs-filter-meta" style={{ marginTop: 12 }}>
          <span className="sd-entity-muted">
            {t('runs.historyPage', { page: String(page), total: String(totalPages) })}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="ghost"
              className="sd-btn-sm"
              disabled={page <= 1 || loadingHistory}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t('runs.historyPrev')}
            </Button>
            <Button
              variant="ghost"
              className="sd-btn-sm"
              disabled={page >= totalPages || loadingHistory}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              {t('runs.historyNext')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
