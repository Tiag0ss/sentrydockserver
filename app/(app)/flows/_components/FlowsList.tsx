'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import { PageHeader, Button, Alert, EmptyState, Panel, Input, Modal } from '@/components/ui';
import {
  IconButton, IconPlay, IconEdit, IconCopy, IconTrash,
} from '@/components/IconActions';
import { SearchSelect, type SearchOption } from './SearchSelect';

export type FlowSummary = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  graph: { nodes: unknown[]; edges: unknown[] };
  scheduleEnabled?: boolean;
  cron?: string | null;
  timezone?: string | null;
  blackoutStart?: string | null;
  blackoutEnd?: string | null;
  lastRun?: {
    id: string;
    status: string;
    startedAt: string;
    finishedAt?: string | null;
    dryRun?: boolean;
  } | null;
  nextRun?: {
    at: string;
    policyId?: string | null;
    policyName?: string | null;
  } | null;
};

type DockerImage = {
  id: string;
  key: string;
  name: string;
  repository: string;
  placeholder: string;
};

type RunningContainersResponse = {
  imageId: string;
  key: string;
  repository: string;
  agents: Array<{
    agentId: string;
    agentName: string;
    online: boolean;
    containers: Array<{
      name: string;
      image: string;
      composeProject?: string | null;
      composeService?: string | null;
    }>;
  }>;
};

type Props = {
  onCreateBlank: () => void;
  onCreatedFromImage: (flowId: string) => void;
  onEdit: (flow: FlowSummary) => void;
};

function runStatusColor(status: string): string {
  if (status === 'success') return '#3dd68c';
  if (status === 'failed' || status === 'aborted' || status === 'rejected') return 'var(--sd-danger)';
  if (status === 'running') return 'var(--sd-accent)';
  if (status === 'waiting_approval' || status === 'awaiting_user' || status === 'interrupted') return 'var(--sd-warn)';
  return 'var(--sd-muted)';
}

export function FlowsList({ onCreateBlank, onCreatedFromImage, onEdit }: Props) {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [runningId, setRunningId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imageId, setImageId] = useState('');
  const [preview, setPreview] = useState<RunningContainersResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [modalError, setModalError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setFlows(await api<FlowSummary[]>('/flows'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('flows.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

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

  const imageOptions: SearchOption[] = useMemo(
    () => images.map((img) => ({
      value: img.id,
      label: img.name || img.key,
      hint: `${img.placeholder || `SD_IMAGE_${img.key}`} · ${img.repository}`,
    })),
    [images],
  );

  const previewStats = useMemo(() => {
    if (!preview) return { containers: 0, agents: 0, selectableIds: [] as string[] };
    let containers = 0;
    let agents = 0;
    const selectableIds: string[] = [];
    for (const ag of preview.agents) {
      if (!ag.online || !ag.containers.length) continue;
      agents += 1;
      for (const c of ag.containers) {
        containers += 1;
        selectableIds.push(`${ag.agentId}:${c.name}`);
      }
    }
    return { containers, agents, selectableIds };
  }, [preview]);

  async function openCreateModal() {
    setModalOpen(true);
    setModalError('');
    setPreviewError('');
    setImageId('');
    setPreview(null);
    setSelectedIds(new Set());
    setImagesLoading(true);
    try {
      setImages(await api<DockerImage[]>('/docker-images'));
    } catch (e) {
      setModalError(e instanceof Error ? e.message : t('common.error'));
      setImages([]);
    } finally {
      setImagesLoading(false);
    }
  }

  useEffect(() => {
    if (!modalOpen || !imageId) {
      setPreview(null);
      setPreviewError('');
      setSelectedIds(new Set());
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError('');
    setPreview(null);
    setSelectedIds(new Set());
    void (async () => {
      try {
        const data = await api<RunningContainersResponse>(
          `/docker-images/${encodeURIComponent(imageId)}/running-containers`,
        );
        if (cancelled) return;
        setPreview(data);
        const next = new Set<string>();
        for (const ag of data.agents) {
          if (!ag.online) continue;
          for (const c of ag.containers) next.add(`${ag.agentId}:${c.name}`);
        }
        setSelectedIds(next);
      } catch (e) {
        if (!cancelled) {
          setPreviewError(e instanceof Error ? e.message : t('flows.scanError'));
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [modalOpen, imageId, t]);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(previewStats.selectableIds));
  }

  function selectNone() {
    setSelectedIds(new Set());
  }

  async function createFromImage() {
    if (!imageId) return;
    if (previewStats.containers > 0 && selectedIds.size === 0) {
      setModalError(t('flows.needSelection'));
      return;
    }
    setCreating(true);
    setModalError('');
    try {
      const targets = [...selectedIds].map((id) => {
        const idx = id.indexOf(':');
        return {
          agentId: id.slice(0, idx),
          containerName: id.slice(idx + 1),
        };
      });
      const res = await api<{ flowId: string }>(
        `/docker-images/${encodeURIComponent(imageId)}/create-update-flow`,
        {
          method: 'POST',
          body: JSON.stringify(targets.length ? { targets } : {}),
        },
      );
      setModalOpen(false);
      onCreatedFromImage(res.flowId);
    } catch (e) {
      setModalError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setCreating(false);
    }
  }

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
        actions={<Button onClick={() => { void openCreateModal(); }}>{t('flows.new')}</Button>}
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
        <div className="sd-entity-list">
          {filtered.map((f) => {
            const nodeCount = f.graph?.nodes?.length ?? 0;
            const edgeCount = f.graph?.edges?.length ?? 0;
            const last = f.lastRun;
            const next = f.nextRun;
            const busy = runningId === f.id;
            return (
              <Panel key={f.id} className="sd-entity-card">
                <div className="sd-entity-item">
                  <div className="sd-entity-main">
                    <div className="sd-entity-top">
                      <strong className="sd-entity-name">{f.name}</strong>
                      {last ? (
                        <>
                          <span
                            className="sd-entity-status"
                            style={{ color: runStatusColor(last.status) }}
                          >
                            {tt(t, 'status', last.status)}
                          </span>
                          {last.dryRun ? (
                            <span className="sd-entity-badge" style={{ color: 'var(--sd-warn)' }}>{t('runs.dryRunBadge')}</span>
                          ) : null}
                          <Link href={`/runs/${last.id}`} className="sd-entity-link">
                            {formatDate(last.finishedAt || last.startedAt)}
                          </Link>
                        </>
                      ) : (
                        <span className="sd-entity-muted">{t('flows.noLastRun')}</span>
                      )}
                      <span className="sd-entity-sep">·</span>
                      {next ? (
                        <span className="sd-entity-muted">
                          {t('flows.nextRun')} {formatDate(next.at)}
                        </span>
                      ) : (
                        <span className="sd-entity-muted">{t('flows.noNextRun')}</span>
                      )}
                    </div>
                    <div className="sd-entity-meta">
                      {f.description || t('flows.noDescription')}
                      {' · '}
                      {nodeCount} {t('flows.nodes')}
                      {' · '}
                      {edgeCount} {t('flows.edges')}
                      {' · '}
                      {t('flows.updated')} {formatDate(f.updatedAt)}
                    </div>
                  </div>
                  <div className="sd-entity-actions">
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

      <Modal
        open={modalOpen}
        title={t('flows.newFromImageTitle')}
        onClose={() => { if (!creating) setModalOpen(false); }}
        footer={(
          <>
            <Button
              variant="ghost"
              disabled={creating}
              onClick={() => {
                setModalOpen(false);
                onCreateBlank();
              }}
            >
              {t('flows.blankFlow')}
            </Button>
            <Button variant="ghost" disabled={creating} onClick={() => setModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={
                !imageId
                || creating
                || previewLoading
                || (previewStats.containers > 0 && selectedIds.size === 0)
              }
              onClick={() => { void createFromImage(); }}
            >
              {creating ? t('flows.creatingFromImage') : t('flows.createFromImage')}
            </Button>
          </>
        )}
      >
        <div className="sd-stack">
          <p style={{ margin: 0, fontSize: 13, color: 'var(--sd-muted)' }}>{t('flows.newFromImageHint')}</p>
          {modalError ? <Alert>{modalError}</Alert> : null}
          {imagesLoading ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--sd-muted)' }}>{t('common.loading')}</p>
          ) : images.length === 0 ? (
            <Alert tone="warn">{t('flows.noImages')}</Alert>
          ) : (
            <SearchSelect
                label={t('flows.selectImage')}
                value={imageId}
                onChange={setImageId}
                options={imageOptions}
                placeholder={t('flows.selectImagePlaceholder')}
                emptyLabel={t('common.none')}
                allowCustom={false}
              />
          )}

          {imageId ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t('flows.previewTitle')}</div>
              {previewLoading ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--sd-muted)' }}>{t('flows.scanning')}</p>
              ) : null}
              {previewError ? <Alert>{previewError}</Alert> : null}
              {preview && !previewLoading ? (
                previewStats.containers === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--sd-muted)' }}>{t('flows.previewEmpty')}</p>
                ) : (
                  <>
                    <div style={{
                      display: 'flex',
                      gap: 10,
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      marginBottom: 8,
                      fontSize: 13,
                      color: 'var(--sd-muted)',
                    }}
                    >
                      <span>
                        {t('flows.previewContainers', {
                          count: String(previewStats.containers),
                          agents: String(previewStats.agents),
                        })}
                        {' · '}
                        {t('flows.selectedCount', { selected: String(selectedIds.size) })}
                      </span>
                      <button
                        type="button"
                        className="sd-btn-ghost sd-btn-sm"
                        onClick={selectAll}
                        disabled={selectedIds.size === previewStats.selectableIds.length}
                      >
                        {t('flows.selectAll')}
                      </button>
                      <button
                        type="button"
                        className="sd-btn-ghost sd-btn-sm"
                        onClick={selectNone}
                        disabled={selectedIds.size === 0}
                      >
                        {t('flows.selectNone')}
                      </button>
                    </div>
                    <ul style={{
                      listStyle: 'none',
                      margin: 0,
                      padding: 0,
                      fontSize: 13,
                      maxHeight: 260,
                      overflow: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                    >
                      {preview.agents.map((ag) => {
                        if (!ag.containers.length) {
                          return (
                            <li key={ag.agentId} style={{ color: 'var(--sd-muted)' }}>
                              {ag.agentName}
                              {!ag.online ? ` (${t('flows.previewOffline')})` : ''}
                            </li>
                          );
                        }
                        return (
                          <li key={ag.agentId}>
                            <strong style={{ display: 'block', marginBottom: 4 }}>{ag.agentName}</strong>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 2 }}>
                              {ag.containers.map((c) => {
                                const id = `${ag.agentId}:${c.name}`;
                                const checked = selectedIds.has(id);
                                return (
                                  <label
                                    key={id}
                                    style={{
                                      display: 'flex',
                                      gap: 8,
                                      alignItems: 'flex-start',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleSelected(id)}
                                      style={{ marginTop: 3 }}
                                    />
                                    <span>
                                      {c.name}
                                      <span style={{ color: 'var(--sd-muted)' }}>
                                        {' · '}
                                        {c.composeProject
                                          ? `${t('flows.previewCompose')}: ${c.composeProject}`
                                          : t('flows.previewRecreate')}
                                        {' · '}
                                        {c.image}
                                      </span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
