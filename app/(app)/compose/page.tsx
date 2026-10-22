'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import {
  PageHeader, Button, Input, Field, Panel, EmptyState, Modal, Alert, Select,
} from '@/components/ui';
import { CollapsibleFilterPanel } from '@/components/CollapsibleFilterPanel';
import { IconButton, IconTrash, IconEdit, IconSave, IconCopy } from '@/components/IconActions';

type AgentRow = { id: string; name: string; online: boolean; labels?: string[] };

type ComposeState = {
  id: string;
  agentId: string;
  agentName?: string;
  online?: boolean;
  status: string;
  desiredHash?: string | null;
  appliedHash?: string | null;
  lastDeployedAt?: string | null;
  lastCheckedAt?: string | null;
  lastError?: string | null;
};

type ComposeProject = {
  id: string;
  name: string;
  yamlText: string;
  contentHash: string;
  states: ComposeState[];
};

const DEFAULT_YAML = `services:
  app:
    image: \${SD_IMAGE_app}
    ports:
      - "\${APP_PORT:-8080}:80"
    environment:
      MYSQL_HOST: \${MYSQLHOST}
`;

function statusColor(status: string): string {
  if (status === 'synced') return '#3dd68c';
  if (status === 'drift' || status === 'pending') return 'var(--warn)';
  if (status === 'error') return 'var(--danger)';
  return 'var(--muted)';
}

export default function ComposePage() {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [projects, setProjects] = useState<ComposeProject[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [yamlText, setYamlText] = useState(DEFAULT_YAML);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deployId, setDeployId] = useState<string | null>(null);
  const [selectedAgents, setSelectedAgents] = useState<Record<string, boolean>>({});
  const [forceDeploy, setForceDeploy] = useState(false);
  const [deployBusy, setDeployBusy] = useState(false);
  const [deployResult, setDeployResult] = useState('');
  const [flowBusyId, setFlowBusyId] = useState<string | null>(null);
  const [flowMsg, setFlowMsg] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importAgentId, setImportAgentId] = useState('');
  const [importScanning, setImportScanning] = useState(false);
  const [importBusy, setImportBusy] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<Array<{
    projectName: string;
    services: string[];
    yamlText: string | null;
    yamlSource: string | null;
    error?: string;
    alreadyImported: boolean;
  }>>([]);

  async function load() {
    const [p, a] = await Promise.all([
      api<ComposeProject[]>('/compose-projects'),
      api<AgentRow[]>('/agents'),
    ]);
    setProjects(p);
    setAgents(a);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : t('common.error')));
  }, [t]);

  const onlineAgents = useMemo(() => agents.filter((a) => a.online), [agents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (statusFilter === 'none') {
        if (p.states.length > 0) return false;
      } else if (statusFilter) {
        if (!p.states.some((s) => s.status === statusFilter)) return false;
      }
      if (!q) return true;
      const hay = [
        p.name,
        p.yamlText,
        p.contentHash,
        p.id,
        ...p.states.map((s) => `${s.agentName || ''} ${s.agentId} ${s.status} ${s.lastError || ''}`),
      ].join('\n').toLowerCase();
      return hay.includes(q);
    });
  }, [projects, query, statusFilter]);

  function openCreate() {
    setEditingId(null);
    setName('');
    setYamlText(DEFAULT_YAML);
    setFormError('');
    setOpen(true);
  }

  function openImport() {
    setImportOpen(true);
    setDiscovered([]);
    setImportAgentId(onlineAgents[0]?.id || '');
    setError('');
  }

  async function scanImport() {
    if (!importAgentId) return;
    setImportScanning(true);
    setError('');
    try {
      const res = await api<{ projects: typeof discovered }>(
        `/compose-projects/discover?agentId=${encodeURIComponent(importAgentId)}`,
      );
      setDiscovered(res.projects || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setImportScanning(false);
    }
  }

  async function importOne(p: (typeof discovered)[number]) {
    if (!p.yamlText) return;
    setImportBusy(p.projectName);
    setError('');
    try {
      const created = await api<{ name: string }>('/compose-projects/import-discovered', {
        method: 'POST',
        body: JSON.stringify({
          name: p.projectName,
          yamlText: p.yamlText,
          sourceProjectName: p.projectName,
          agentId: importAgentId,
        }),
      });
      setFlowMsg(t('compose.importDone', { name: created.name }));
      await load();
      setDiscovered((prev) => prev.map((x) => (
        x.projectName === p.projectName ? { ...x, alreadyImported: true } : x
      )));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setImportBusy(null);
    }
  }

  function openEdit(p: ComposeProject) {
    setEditingId(p.id);
    setName(p.name);
    setYamlText(p.yamlText);
    setFormError('');
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    setFormError('');
    try {
      if (editingId) {
        await api(`/compose-projects/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({ name, yamlText }),
        });
      } else {
        await api('/compose-projects', {
          method: 'POST',
          body: JSON.stringify({ name, yamlText }),
        });
      }
      setOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm(t('compose.confirmDelete'))) return;
    try {
      await api(`/compose-projects/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  async function duplicate(id: string) {
    setError('');
    try {
      const copy = await api<ComposeProject>(`/compose-projects/${id}/duplicate`, {
        method: 'POST',
        body: '{}',
      });
      await load();
      openEdit(copy);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  function openDeploy(p: ComposeProject) {
    setDeployId(p.id);
    setForceDeploy(false);
    setDeployResult('');
    const sel: Record<string, boolean> = {};
    for (const a of onlineAgents) sel[a.id] = false;
    setSelectedAgents(sel);
  }

  async function runDeploy() {
    if (!deployId) return;
    const agentIds = Object.entries(selectedAgents).filter(([, v]) => v).map(([k]) => k);
    if (!agentIds.length) {
      setDeployResult(t('compose.pickAgents'));
      return;
    }
    setDeployBusy(true);
    setDeployResult('');
    try {
      const res = await api<{ results: Array<{ agentName: string; status: string; skipped?: boolean; error?: string }> }>(
        `/compose-projects/${deployId}/deploy`,
        { method: 'POST', body: JSON.stringify({ agentIds, force: forceDeploy }) },
      );
      const lines = res.results.map((r) => {
        if (r.skipped) return `${r.agentName}: ${t('compose.skipped')}`;
        if (r.error) return `${r.agentName}: ${r.error}`;
        return `${r.agentName}: ${r.status}`;
      });
      setDeployResult(lines.join('\n'));
      await load();
    } catch (e) {
      setDeployResult(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setDeployBusy(false);
    }
  }

  async function runCheck(id: string) {
    try {
      await api(`/compose-projects/${id}/check`, { method: 'POST', body: '{}' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  async function createUpdateFlow(p: ComposeProject) {
    setFlowBusyId(p.id);
    setFlowMsg('');
    setError('');
    try {
      const res = await api<{
        flowId: string;
        name: string;
        targetsCount: number;
        warnings?: string[];
      }>(`/compose-projects/${p.id}/create-update-flow`, { method: 'POST', body: '{}' });
      const warn = res.warnings?.length ? ` ${res.warnings.join(' ')}` : '';
      setFlowMsg(t('compose.flowCreated', { name: res.name, count: res.targetsCount }) + warn);
      router.push(`/flows?edit=${encodeURIComponent(res.flowId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setFlowBusyId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        title={t('compose.title')}
        subtitle={t('compose.subtitle')}
        actions={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="ghost" onClick={openImport}>{t('compose.importFromAgent')}</Button>
            <Button onClick={openCreate}>{t('compose.create')}</Button>
          </div>
        )}
      />
      {error ? <Alert>{error}</Alert> : null}
      {flowMsg ? <Alert>{flowMsg}</Alert> : null}

      {projects.length > 0 ? (
        <CollapsibleFilterPanel
          activeCount={[query.trim(), statusFilter].filter(Boolean).length}
          onClear={() => { setQuery(''); setStatusFilter(''); }}
          headerExtra={(
            <span className="sd-entity-muted" style={{ fontSize: 12 }}>
              {filtered.length}/{projects.length}
            </span>
          )}
        >
          <div className="sd-form-row">
            <Field label={t('compose.search')}>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('compose.search')}
                aria-label={t('compose.search')}
              />
            </Field>
            <Field label={t('compose.filterStatus')}>
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label={t('compose.filterStatus')}
              >
                <option value="">{t('compose.filterAll')}</option>
                <option value="synced">{t('compose.statusSynced')}</option>
                <option value="drift">{t('compose.statusDrift')}</option>
                <option value="pending">{t('compose.statusPending')}</option>
                <option value="error">{t('compose.statusError')}</option>
                <option value="none">{t('compose.filterNoDeploy')}</option>
              </Select>
            </Field>
          </div>
        </CollapsibleFilterPanel>
      ) : null}

      {projects.length === 0 ? (
        <EmptyState>{t('compose.empty')}</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState>{t('compose.searchEmpty')}</EmptyState>
      ) : (
        filtered.map((p) => (
          <Panel key={p.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              <div>
                <strong style={{ fontSize: 16 }}>{p.name}</strong>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  hash {p.contentHash.slice(0, 12)}…
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button variant="ghost" onClick={() => openDeploy(p)}>{t('compose.deploy')}</Button>
                <Button variant="ghost" onClick={() => void runCheck(p.id)}>{t('compose.check')}</Button>
                <Button
                  variant="ghost"
                  disabled={flowBusyId === p.id || p.states.length === 0}
                  title={p.states.length === 0 ? t('compose.flowNeedsDeploy') : undefined}
                  onClick={() => { void createUpdateFlow(p); }}
                >
                  {flowBusyId === p.id ? t('compose.creatingFlow') : t('compose.createUpdateFlow')}
                </Button>
                <IconButton label={t('common.edit')} onClick={() => openEdit(p)}><IconEdit /></IconButton>
                <IconButton label={t('compose.duplicate')} onClick={() => { void duplicate(p.id); }}>
                  <IconCopy />
                </IconButton>
                <IconButton label={t('common.delete')} onClick={() => void remove(p.id)}><IconTrash /></IconButton>
              </div>
            </div>
            <pre style={{
              margin: 0,
              maxHeight: 160,
              overflow: 'auto',
              fontSize: 12,
              background: 'var(--sd-bg)',
              padding: 10,
              borderRadius: 8,
              border: '1px solid var(--sd-border)',
            }}
            >
              {p.yamlText}
            </pre>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t('compose.agentStates')}</div>
              {p.states.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('compose.noStates')}</div>
              ) : (
                p.states.map((s) => (
                  <div key={s.id} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13, alignItems: 'center' }}>
                    <span>{s.agentName || s.agentId}</span>
                    <strong style={{ color: statusColor(s.status) }}>
                      {(() => {
                        const key = `compose.status${s.status.charAt(0).toUpperCase()}${s.status.slice(1)}`;
                        const label = t(key);
                        return label === key ? s.status : label;
                      })()}
                    </strong>
                    {s.lastDeployedAt ? (
                      <span style={{ color: 'var(--muted)' }}>
                        {t('compose.lastDeploy')}: {formatDate(s.lastDeployedAt)}
                      </span>
                    ) : null}
                    {s.lastError ? <span style={{ color: 'var(--danger)' }}>{s.lastError}</span> : null}
                  </div>
                ))
              )}
            </div>
          </Panel>
        ))
      )}

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title={t('compose.importTitle')} wide>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="sd-entity-muted" style={{ margin: 0, fontSize: 13 }}>{t('compose.importHint')}</p>
          <div className="sd-form-row">
            <Field label={t('compose.importPickAgent')}>
              <Select
                value={importAgentId}
                onChange={(e) => setImportAgentId(e.target.value)}
              >
                <option value="">{t('common.none')}</option>
                {onlineAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Button
                onClick={() => { void scanImport(); }}
                disabled={!importAgentId || importScanning}
              >
                {importScanning ? t('compose.importScanning') : t('compose.importScan')}
              </Button>
            </div>
          </div>
          {onlineAgents.length === 0 ? (
            <Alert>{t('compose.noOnlineAgents')}</Alert>
          ) : null}
          {!importScanning && discovered.length === 0 && importAgentId ? (
            <EmptyState>{t('compose.importEmpty')}</EmptyState>
          ) : null}
          <div className="sd-entity-list">
            {discovered.map((p) => (
              <Panel key={p.projectName} className="sd-entity-card">
                <div className="sd-entity-item">
                  <div className="sd-entity-main">
                    <div className="sd-entity-top">
                      <strong className="sd-entity-name">{p.projectName}</strong>
                      <span className="sd-entity-muted" style={{ fontSize: 12 }}>
                        {t('compose.importServices', { count: String(p.services?.length || 0) })}
                      </span>
                    </div>
                    <div className="sd-entity-meta">
                      {p.alreadyImported ? t('compose.importAlready') : null}
                      {!p.yamlText ? (p.error || t('compose.importNoYaml')) : (p.yamlSource || '')}
                    </div>
                  </div>
                  <Button
                    className="sd-btn-sm"
                    disabled={!p.yamlText || p.alreadyImported || importBusy === p.projectName}
                    onClick={() => { void importOne(p); }}
                  >
                    {importBusy === p.projectName ? t('compose.importImporting') : t('compose.importAction')}
                  </Button>
                </div>
              </Panel>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>{t('common.close')}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={open} onClose={() => setOpen(false)} title={editingId ? t('compose.edit') : t('compose.create')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label={t('compose.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('compose.yaml')}>
            <textarea
              value={yamlText}
              onChange={(e) => setYamlText(e.target.value)}
              rows={16}
              style={{
                width: '100%',
                fontFamily: 'ui-monospace, monospace',
                fontSize: 12,
                background: 'var(--sd-panel)',
                border: '1px solid var(--sd-border)',
                borderRadius: 6,
                padding: 8,
                color: 'var(--sd-text)',
                boxSizing: 'border-box',
              }}
            />
          </Field>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('compose.yamlHint')}</div>
          {formError ? <Alert>{formError}</Alert> : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => void save()} disabled={saving || !name.trim() || !yamlText.trim()}>
              <IconSave /> {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(deployId)} onClose={() => setDeployId(null)} title={t('compose.deploy')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13 }}>{t('compose.pickAgents')}</div>
          {onlineAgents.length === 0 ? (
            <div style={{ color: 'var(--muted)' }}>{t('compose.noOnlineAgents')}</div>
          ) : (
            onlineAgents.map((a) => (
              <label key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={Boolean(selectedAgents[a.id])}
                  onChange={(e) => setSelectedAgents((s) => ({ ...s, [a.id]: e.target.checked }))}
                />
                {a.name}
                {a.labels?.length ? (
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>({a.labels.join(', ')})</span>
                ) : null}
              </label>
            ))
          )}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={forceDeploy} onChange={(e) => setForceDeploy(e.target.checked)} />
            {t('compose.force')}
          </label>
          {deployResult ? (
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>{deployResult}</pre>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button variant="ghost" onClick={() => setDeployId(null)}>{t('common.cancel')}</Button>
            {deployId && deployResult && !deployBusy ? (
              <Button
                variant="ghost"
                disabled={flowBusyId === deployId}
                onClick={() => {
                  const p = projects.find((x) => x.id === deployId);
                  if (p) void createUpdateFlow(p);
                }}
              >
                {flowBusyId === deployId ? t('compose.creatingFlow') : t('compose.createUpdateFlow')}
              </Button>
            ) : null}
            <Button onClick={() => void runDeploy()} disabled={deployBusy}>
              {deployBusy ? t('compose.deploying') : t('compose.deploy')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
