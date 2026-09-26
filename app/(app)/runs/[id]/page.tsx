'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import { Modal, Button } from '@/components/ui';
import { RunFlowChart, RunStatusLegend, type NodeStatusMap, type RunGraph } from '../_components/RunFlowChart';
import { ActionIconButton } from '../_components/RunActionIcons';
import { IconEdit, IconRefresh } from '@/components/IconActions';

type StepDetail = {
  agentId?: string;
  agentName?: string;
  containerName?: string;
  image?: string;
  oldDigest?: string;
  newDigest?: string;
  previousDigest?: string;
  desiredDigest?: string;
  updateAvailable?: boolean;
  reason?: string;
  branch?: string;
  field?: string;
  value?: boolean;
  healthy?: boolean;
  rolledBack?: boolean;
  probe?: string;
  healthUrl?: string;
  projectPath?: string;
  action?: string;
  message?: string;
  url?: string;
  method?: string;
  httpStatus?: number;
  templateKey?: string;
  dryRun?: boolean;
  elapsedMs?: number;
  remoteDigests?: string[];
  childRunId?: string;
  flowId?: string;
  wait?: boolean;
  status?: string;
  skipped?: boolean;
};

type RunStep = {
  id: string;
  nodeId: string;
  nodeType?: string;
  label?: string;
  status: string;
  attempts: number;
  lastError: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  detail?: StepDetail | null;
};
type RunBranch = {
  id: string;
  agentId: string;
  agentName?: string | null;
  status: string;
  containerName: string;
};
type RunDetail = {
  id: string;
  status: string;
  currentNodeId: string | null;
  flowId: string;
  dryRun?: boolean | number;
  context?: Record<string, unknown> | null;
  steps: RunStep[];
  branches: RunBranch[];
  flow: { id: string; name: string; graph: RunGraph } | null;
  nodeStatuses: NodeStatusMap;
  parentRunId?: string | null;
  parent?: { id: string; flowId: string; flowName: string; status: string } | null;
  children?: Array<{
    id: string;
    flowId: string;
    flowName: string;
    status: string;
    parentStepId?: string | null;
  }>;
};

function stepStatusColor(status: string): string {
  if (status === 'success') return '#3dd68c';
  if (status === 'failed') return 'var(--danger)';
  if (status === 'rejected') return 'var(--warn)';
  if (status === 'running') return 'var(--accent)';
  if (status === 'interrupted' || status === 'waiting_approval' || status === 'awaiting_user') {
    return 'var(--warn)';
  }
  return 'var(--muted)';
}

function statusLabel(t: (key: string) => string, status: string): string {
  return tt(t, 'status', status);
}

function shortDigest(value: string | undefined | null): string | null {
  if (!value) return null;
  const raw = String(value);
  if (raw.startsWith('sha256:')) {
    return `sha256:${raw.slice(7, 19)}…`;
  }
  if (raw.length > 20) return `${raw.slice(0, 16)}…`;
  return raw;
}

function DetailRow({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 140px) 1fr', gap: 8, fontSize: 12, lineHeight: 1.45 }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <span style={{
        fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
        wordBreak: 'break-all',
      }}>
        {children}
      </span>
    </div>
  );
}

function DigestValue({ value }: { value: string }) {
  return <span title={value}>{shortDigest(value)}</span>;
}

function StepDetailBlock({
  detail,
  t,
}: {
  detail: StepDetail;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const rows: React.ReactNode[] = [];

  if (detail.dryRun) {
    rows.push(
      <DetailRow key="dry" label={t('runs.detailDryRun')}>
        {t('runs.detailDryRunYes')}
      </DetailRow>,
    );
  }

  if (detail.updateAvailable != null) {
    rows.push(
      <DetailRow key="reason" label={t('runs.detailReason')}>
        {detail.updateAvailable ? t('runs.detailUpdateYes') : t('runs.detailUpdateNo')}
      </DetailRow>,
    );
  } else if (detail.reason === 'digest_mismatch') {
    rows.push(
      <DetailRow key="reason" label={t('runs.detailReason')}>
        {t('runs.detailUpdateYes')}
      </DetailRow>,
    );
  } else if (detail.reason === 'up_to_date') {
    rows.push(
      <DetailRow key="reason" label={t('runs.detailReason')}>
        {t('runs.detailUpdateNo')}
      </DetailRow>,
    );
  }

  if (detail.containerName) {
    rows.push(
      <DetailRow key="container" label={t('contextFields.containerName')}>
        {detail.containerName}
      </DetailRow>,
    );
  }
  if (detail.image) {
    rows.push(
      <DetailRow key="image" label={t('contextFields.image')}>
        {detail.image}
      </DetailRow>,
    );
  }
  if (detail.agentName || detail.agentId) {
    rows.push(
      <DetailRow key="agent" label={t('contextFields.agentId')}>
        {detail.agentName || shortDigest(detail.agentId)}
      </DetailRow>,
    );
  }
  if (detail.oldDigest) {
    rows.push(
      <DetailRow key="old" label={t('contextFields.oldDigest')} mono>
        <DigestValue value={detail.oldDigest} />
      </DetailRow>,
    );
  }
  if (detail.newDigest) {
    rows.push(
      <DetailRow key="new" label={t('contextFields.newDigest')} mono>
        <DigestValue value={detail.newDigest} />
      </DetailRow>,
    );
  }
  if (detail.desiredDigest) {
    rows.push(
      <DetailRow key="desired" label={t('runs.detailDesiredDigest')} mono>
        <DigestValue value={detail.desiredDigest} />
      </DetailRow>,
    );
  }
  if (detail.previousDigest) {
    rows.push(
      <DetailRow key="prev" label={t('runs.detailPreviousDigest')} mono>
        <DigestValue value={detail.previousDigest} />
      </DetailRow>,
    );
  }
  if (detail.field) {
    const fieldLabel = t(`contextFields.${detail.field}`);
    rows.push(
      <DetailRow key="field" label={t('runs.detailCondition')}>
        {(fieldLabel !== `contextFields.${detail.field}` ? fieldLabel : detail.field)}
        {' = '}
        <strong>{detail.value ? t('runs.detailTrue') : t('runs.detailFalse')}</strong>
      </DetailRow>,
    );
  }
  if (detail.healthy != null) {
    rows.push(
      <DetailRow key="health" label={t('runs.detailHealth')}>
        {detail.healthy ? t('runs.detailHealthy') : t('runs.detailUnhealthy')}
        {detail.elapsedMs != null ? ` · ${Math.round(detail.elapsedMs / 1000)}s` : ''}
      </DetailRow>,
    );
  }
  if (detail.rolledBack) {
    rows.push(
      <DetailRow key="rb" label={t('runs.detailRollback')}>
        {t('runs.detailRolledBack')}
      </DetailRow>,
    );
  }
  if (detail.projectPath) {
    rows.push(
      <DetailRow key="path" label={t('runs.detailProjectPath')} mono>
        {detail.projectPath}
        {detail.action ? ` (${detail.action})` : ''}
      </DetailRow>,
    );
  }
  if (detail.branch) {
    const branchKey = `ports.${detail.branch}`;
    const branchLabel = t(branchKey);
    rows.push(
      <DetailRow key="branch" label={t('runs.detailBranch')}>
        {branchLabel !== branchKey ? branchLabel : detail.branch}
      </DetailRow>,
    );
  }
  if (detail.message) {
    rows.push(
      <DetailRow key="msg" label={t('runs.detailMessage')}>
        {detail.message}
      </DetailRow>,
    );
  }
  if (detail.url) {
    rows.push(
      <DetailRow key="url" label={t('runs.detailWebhook')}>
        {detail.method || 'POST'} {detail.url}
        {detail.httpStatus != null ? ` · HTTP ${detail.httpStatus}` : ''}
      </DetailRow>,
    );
  }

  if (rows.length === 0) return null;

  return (
    <div style={{
      marginTop: 8,
      marginLeft: 30,
      padding: '10px 12px',
      borderRadius: 8,
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      {rows}
    </div>
  );
}

function RunContextPanel({
  context,
  t,
}: {
  context: Record<string, unknown>;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const image = context.image != null ? String(context.image) : '';
  const container = context.containerName != null ? String(context.containerName) : '';
  const oldDigest = context.oldDigest != null ? String(context.oldDigest) : '';
  const newDigest = context.newDigest != null ? String(context.newDigest) : '';
  const updateAvailable = context.updateAvailable;
  const targets = Array.isArray(context.targets) ? context.targets : [];
  const skipped = Array.isArray(context.skippedTargets) ? context.skippedTargets : [];

  if (!image && !container && !oldDigest && !newDigest && updateAvailable == null && !targets.length) {
    return null;
  }

  return (
    <section style={{
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '12px 14px',
      background: 'var(--panel)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>{t('runs.contextTitle')}</h2>
      {updateAvailable != null && (
        <DetailRow label={t('runs.detailReason')}>
          {updateAvailable ? t('runs.detailUpdateYes') : t('runs.detailUpdateNo')}
        </DetailRow>
      )}
      {targets.length > 0 && (
        <DetailRow label={t('runs.targetsToUpdate')}>
          {targets.length}
        </DetailRow>
      )}
      {skipped.length > 0 && (
        <DetailRow label={t('runs.targetsSkipped')}>
          {skipped.length}
        </DetailRow>
      )}
      {container ? <DetailRow label={t('contextFields.containerName')}>{container}</DetailRow> : null}
      {image ? <DetailRow label={t('contextFields.image')}>{image}</DetailRow> : null}
      {oldDigest ? (
        <DetailRow label={t('contextFields.oldDigest')} mono>
          <DigestValue value={oldDigest} />
        </DetailRow>
      ) : null}
      {newDigest ? (
        <DetailRow label={t('contextFields.newDigest')} mono>
          <DigestValue value={newDigest} />
        </DetailRow>
      ) : null}
    </section>
  );
}

function findChildRunIdForNode(run: RunDetail, nodeId: string): string | null {
  const nodeSteps = (run.steps || []).filter((s) => s.nodeId === nodeId);
  for (let i = nodeSteps.length - 1; i >= 0; i -= 1) {
    const childId = nodeSteps[i].detail?.childRunId;
    if (childId && typeof childId === 'string') return childId;
  }
  const stepIds = new Set(nodeSteps.map((s) => s.id));
  const child = (run.children || []).find(
    (c) => c.parentStepId && stepIds.has(c.parentStepId),
  );
  return child?.id || null;
}

export default function RunDetailPage() {
  const { t, formatDate } = useI18n();
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState('');
  const [overrideTargetTag, setOverrideTargetTag] = useState('');
  const [childBusyId, setChildBusyId] = useState<string | null>(null);
  const [childActionError, setChildActionError] = useState('');
  const [childModalId, setChildModalId] = useState<string | null>(null);
  const [childModalRun, setChildModalRun] = useState<RunDetail | null>(null);
  const [childModalLoading, setChildModalLoading] = useState(false);
  const [childModalError, setChildModalError] = useState('');

  async function load() {
    setRun(await api<RunDetail>(`/runs/${id}`));
  }

  const loadChildModal = useCallback(async (childId: string) => {
    setChildModalLoading(true);
    setChildModalError('');
    try {
      const detail = await api<RunDetail>(`/runs/${childId}`);
      setChildModalRun(detail);
    } catch (e) {
      setChildModalError(e instanceof Error ? e.message : t('runs.actionError'));
      setChildModalRun(null);
    } finally {
      setChildModalLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!childModalId || childModalId === '__missing__') {
      if (childModalId !== '__missing__') setChildModalRun(null);
      return;
    }
    void loadChildModal(childModalId);
    const timer = setInterval(() => { void loadChildModal(childModalId); }, 3000);
    return () => clearInterval(timer);
  }, [childModalId, loadChildModal]);

  async function decideChild(childId: string, ok: boolean) {
    setChildBusyId(childId);
    setChildActionError('');
    try {
      await api(`/runs/${childId}/continue`, {
        method: 'POST',
        body: JSON.stringify({ continue: ok }),
      });
      await load();
      if (childModalId === childId) await loadChildModal(childId);
    } catch (e) {
      setChildActionError(e instanceof Error ? e.message : t('runs.actionError'));
    } finally {
      setChildBusyId(null);
    }
  }

  function openChildFromNode(nodeId: string) {
    if (!run) return;
    const childId = findChildRunIdForNode(run, nodeId);
    if (!childId) {
      setChildModalRun(null);
      setChildModalError(t('runs.childRunNotStarted'));
      setChildModalId('__missing__');
      return;
    }
    setChildModalError('');
    setChildModalId(childId);
  }

  async function rerun() {
    setRerunning(true);
    setRerunError('');
    try {
      const res = await api<{ runId: string }>(`/runs/${id}/rerun`, { method: 'POST', body: '{}' });
      router.push(`/runs/${res.runId}`);
    } catch (e) {
      setRerunError(e instanceof Error ? e.message : t('runs.rerunError'));
    } finally {
      setRerunning(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => { void load(); }, 3000);
    return () => clearInterval(timer);
  }, [id]);

  if (!run) return <p>{t('runs.loading')}</p>;

  const currentNode = run.flow?.graph?.nodes?.find((n) => n.id === run.currentNodeId);
  const currentType = currentNode
    ? String(currentNode.type || currentNode.data?.nodeType || '')
    : '';
  const currentLabel = currentType
    ? (t(`nodes.${currentType}`) !== `nodes.${currentType}` ? t(`nodes.${currentType}`) : currentType)
    : run.currentNodeId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {run.parent && (
        <nav style={{ fontSize: 13, color: 'var(--muted)' }}>
          <Link href={`/runs/${run.parent.id}`} style={{ color: 'var(--accent)' }}>
            {run.parent.flowName}
          </Link>
          {' ← '}
          <span>{run.flow?.name || run.id.slice(0, 8)}</span>
        </nav>
      )}
      <header style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{run.flow?.name || t('runs.runFallback', { id: run.id.slice(0, 8) })}</h1>
        <span style={{ color: 'var(--muted)', fontSize: 14 }} title={run.id}>{run.id.slice(0, 8)}…</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {run.flowId ? (
            <ActionIconButton
              title={t('runs.editFlow')}
              onClick={() => router.push(`/flows?edit=${run.flowId}`)}
            >
              <IconEdit />
            </ActionIconButton>
          ) : null}
          <ActionIconButton
            title={t('runs.rerun')}
            primary
            disabled={rerunning}
            onClick={() => { void rerun(); }}
          >
            <IconRefresh />
          </ActionIconButton>
        </div>
      </header>
      {rerunError && <p style={{ color: 'var(--danger)', margin: 0, fontSize: 13 }}>{rerunError}</p>}

      {run.dryRun ? (
        <div style={{
          padding: '10px 14px',
          borderRadius: 10,
          border: '1px solid var(--warn)',
          background: 'rgba(230, 180, 80, 0.12)',
          color: 'var(--warn)',
          fontSize: 13,
          lineHeight: 1.45,
        }}>
          <strong>{t('runs.dryRunBadge')}</strong>
          {' — '}
          {t('runs.dryRunBanner')}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
        <span>
          {t('runs.status')}:{' '}
          <strong style={{ color: stepStatusColor(run.status) }}>{statusLabel(t, run.status)}</strong>
        </span>
        {run.currentNodeId ? (
          <span style={{ color: 'var(--muted)' }}>
            {t('runs.step')}: {currentLabel}
          </span>
        ) : null}
      </div>

      {run.children && run.children.length > 0 && (
        <section style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '12px 14px',
          background: 'var(--panel)',
        }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>{t('runs.childRuns')}</h2>
          {childActionError ? (
            <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--danger)' }}>{childActionError}</p>
          ) : null}
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 13 }}>
            {run.children.map((c) => {
              const needsDecision = c.status === 'waiting_approval' || c.status === 'awaiting_user';
              const isApproval = c.status === 'waiting_approval';
              const busy = childBusyId === c.id;
              const otherBusy = childBusyId !== null && !busy;
              return (
                <li
                  key={c.id}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 8,
                    paddingBottom: 8,
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <Link href={`/runs/${c.id}`} style={{ color: 'var(--accent)' }}>
                      {c.flowName}
                    </Link>
                    {' · '}
                    <span style={{ color: stepStatusColor(c.status) }}>{statusLabel(t, c.status)}</span>
                    <span style={{ color: 'var(--muted)' }}> · {c.id.slice(0, 8)}…</span>
                  </div>
                  {needsDecision ? (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        type="button"
                        disabled={busy || otherBusy}
                        onClick={() => { void decideChild(c.id, true); }}
                        style={{
                          background: 'var(--accent)',
                          border: 'none',
                          padding: '6px 10px',
                          borderRadius: 8,
                          cursor: busy || otherBusy ? 'not-allowed' : 'pointer',
                          fontWeight: 600,
                          fontSize: 12,
                          opacity: busy || otherBusy ? 0.6 : 1,
                        }}
                      >
                        {isApproval ? t('runs.approve') : t('runs.continue')}
                      </button>
                      <button
                        type="button"
                        disabled={busy || otherBusy}
                        onClick={() => { void decideChild(c.id, false); }}
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--danger)',
                          color: 'var(--danger)',
                          padding: '6px 10px',
                          borderRadius: 8,
                          cursor: busy || otherBusy ? 'not-allowed' : 'pointer',
                          fontSize: 12,
                          opacity: busy || otherBusy ? 0.6 : 1,
                        }}
                      >
                        {isApproval ? t('runs.reject') : t('runs.abort')}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(run.status === 'awaiting_user' || run.status === 'waiting_approval') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {run.status === 'waiting_approval' && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', maxWidth: 480, lineHeight: 1.45 }}>
              {t('runs.approvalHint')}
              {run.context?.image ? (
                <>
                  {' '}
                  <code style={{ color: 'var(--sd-text)' }}>{String(run.context.image)}</code>
                </>
              ) : null}
            </p>
          )}
          {run.status === 'waiting_approval'
            && Boolean(currentNode?.data?.allowTargetOverride) && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 360 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('runs.overrideTargetTag')}</span>
              <input
                value={overrideTargetTag}
                onChange={(e) => setOverrideTargetTag(e.target.value)}
                placeholder={t('runs.overrideTargetTagPlaceholder')}
                style={{
                  background: 'var(--sd-panel)',
                  border: '1px solid var(--sd-border)',
                  borderRadius: 6,
                  padding: '6px 8px',
                  color: 'var(--sd-text)',
                }}
              />
            </label>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={async () => {
              await api(`/runs/${id}/continue`, {
                method: 'POST',
                body: JSON.stringify({
                  continue: true,
                  ...(overrideTargetTag.trim()
                    ? { targetTag: overrideTargetTag.trim(), targetMode: 'pin_tag' }
                    : {}),
                }),
              });
              await load();
            }}
              style={{ background: 'var(--accent)', border: 'none', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
              {run.status === 'waiting_approval' ? t('runs.approve') : t('runs.continue')}
            </button>
            <button type="button" onClick={async () => { await api(`/runs/${id}/continue`, { method: 'POST', body: JSON.stringify({ continue: false }) }); await load(); }}
              style={{ background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '8px 12px', borderRadius: 8, cursor: 'pointer' }}>
              {run.status === 'waiting_approval' ? t('runs.reject') : t('runs.abort')}
            </button>
          </div>
        </div>
      )}

      {run.context ? <RunContextPanel context={run.context} t={t} /> : null}

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
            onNodeClick={({ nodeId, nodeType }) => {
              if (nodeType === 'run_flow') openChildFromNode(nodeId);
            }}
          />
        </section>
      )}

      <Modal
        open={Boolean(childModalId)}
        wide
        title={
          childModalRun?.flow?.name
            ? t('runs.childRunModalTitle', { name: childModalRun.flow.name })
            : t('runs.childRunModalTitleFallback')
        }
        onClose={() => {
          setChildModalId(null);
          setChildModalRun(null);
          setChildModalError('');
        }}
        footer={
          childModalRun ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {(childModalRun.status === 'waiting_approval' || childModalRun.status === 'awaiting_user') ? (
                <>
                  <Button
                    className="sd-btn-sm"
                    disabled={childBusyId === childModalRun.id}
                    onClick={() => { void decideChild(childModalRun.id, true); }}
                  >
                    {childModalRun.status === 'waiting_approval' ? t('runs.approve') : t('runs.continue')}
                  </Button>
                  <Button
                    variant="danger"
                    className="sd-btn-sm"
                    disabled={childBusyId === childModalRun.id}
                    onClick={() => { void decideChild(childModalRun.id, false); }}
                  >
                    {childModalRun.status === 'waiting_approval' ? t('runs.reject') : t('runs.abort')}
                  </Button>
                </>
              ) : null}
              <Link href={`/runs/${childModalRun.id}`} className="sd-entity-link" style={{ alignSelf: 'center' }}>
                {t('runs.openDetail')}
              </Link>
            </div>
          ) : undefined
        }
      >
        {childModalLoading && !childModalRun ? (
          <p style={{ margin: 0, color: 'var(--muted)' }}>{t('runs.loading')}</p>
        ) : null}
        {childModalError ? (
          <p style={{ margin: '0 0 12px', color: 'var(--danger)', fontSize: 13 }}>{childModalError}</p>
        ) : null}
        {childModalRun ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', fontSize: 14 }}>
              <span>
                {t('runs.status')}:{' '}
                <strong style={{ color: stepStatusColor(childModalRun.status) }}>
                  {statusLabel(t, childModalRun.status)}
                </strong>
              </span>
              {childModalRun.currentNodeId ? (
                <span style={{ color: 'var(--muted)' }}>
                  {t('runs.step')}:{' '}
                  {(() => {
                    const n = childModalRun.flow?.graph?.nodes?.find((x) => x.id === childModalRun.currentNodeId);
                    const typ = n ? String(n.type || n.data?.nodeType || '') : '';
                    if (!typ) return childModalRun.currentNodeId;
                    const key = `nodes.${typ}`;
                    const tr = t(key);
                    return tr !== key ? tr : typ;
                  })()}
                </span>
              ) : null}
              <span style={{ color: 'var(--muted)', fontSize: 12 }} title={childModalRun.id}>
                {childModalRun.id.slice(0, 8)}…
              </span>
            </div>
            {childActionError ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{childActionError}</p>
            ) : null}
            {childModalRun.flow?.graph ? (
              <>
                <RunStatusLegend />
                <RunFlowChart
                  graph={childModalRun.flow.graph}
                  nodeStatuses={childModalRun.nodeStatuses || {}}
                  currentNodeId={childModalRun.currentNodeId}
                  height={360}
                />
              </>
            ) : (
              <p style={{ margin: 0, color: 'var(--muted)' }}>{t('runs.noGraph')}</p>
            )}
          </div>
        ) : null}
      </Modal>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{t('runs.steps')}</h2>
        {(!run.steps || run.steps.length === 0) && (
          <p style={{ color: 'var(--muted)', margin: 0, fontSize: 14 }}>{t('runs.noSteps')}</p>
        )}
        {run.steps?.map((s, index) => {
          const typeKey = `nodes.${s.nodeType || ''}`;
          const translated = s.nodeType ? t(typeKey) : '';
          const title = translated && translated !== typeKey
            ? translated
            : (s.label || s.nodeType || s.nodeId);
          const statusText = statusLabel(t, s.status);
          return (
            <div
              key={s.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '12px 14px',
                background: 'var(--panel)',
              }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--muted)', fontSize: 12, fontVariantNumeric: 'tabular-nums', minWidth: 20 }}>
                  {index + 1}.
                </span>
                <strong style={{ fontSize: 14 }}>{title}</strong>
                <span style={{
                  color: stepStatusColor(s.status),
                  fontWeight: 600,
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                }}>
                  {statusText}
                </span>
                {s.attempts > 1 && (
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {t('runs.attempts')} ×{s.attempts}
                  </span>
                )}
                <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 'auto' }} title={s.nodeId}>
                  {s.startedAt ? formatDate(s.startedAt) : null}
                </span>
              </div>
              {s.detail ? <StepDetailBlock detail={s.detail} t={t} /> : null}
              {s.lastError && (
                <div style={{
                  marginTop: 8,
                  marginLeft: 30,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'rgba(240, 113, 120, 0.1)',
                  color: 'var(--danger)',
                  fontSize: 13,
                  lineHeight: 1.4,
                }}>
                  {s.lastError}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {run.branches?.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>{t('runs.branches')}</h2>
          {run.branches.map((b) => (
            <div key={b.id} style={{
              borderBottom: '1px solid var(--border)',
              padding: '8px 4px',
              fontSize: 14,
            }}>
              <strong>{b.agentName || b.agentId.slice(0, 8)}</strong>
              {b.containerName ? <span style={{ color: 'var(--muted)' }}> · {b.containerName}</span> : null}
              {' — '}
              <span style={{ color: stepStatusColor(b.status) }}>{statusLabel(t, b.status)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
