'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import {
  PageHeader, Button, Input, Select, Field, Alert, EmptyState, Panel, Modal, Tabs,
} from '@/components/ui';
import { IconButton, IconTrash, IconEdit } from '@/components/IconActions';

type Agent = {
  id: string;
  name: string;
  status: string;
  online: boolean;
  transport: string;
  protocolVersion: number | null;
  agentVersion?: string | null;
  token?: string;
  labels?: string[];
  envKeys?: string[];
  meta?: {
    containers?: number;
    danglingImages?: number;
    diskUsedBytes?: number;
    diskTotalBytes?: number;
  } | null;
};

type EditTab = 'labels' | 'env';
type EnvFormMode = 'create' | 'edit' | null;

function parseLabels(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function AgentsPage() {
  const { t } = useI18n();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState('ws');
  const [createdToken, setCreatedToken] = useState('');
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [editTab, setEditTab] = useState<EditTab>('labels');
  const [editLabels, setEditLabels] = useState('');
  const [initialEnvKeys, setInitialEnvKeys] = useState<string[]>([]);
  const [draftEnvKeys, setDraftEnvKeys] = useState<string[]>([]);
  const [envUpsert, setEnvUpsert] = useState<Record<string, string>>({});
  const [envDelete, setEnvDelete] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const [envMode, setEnvMode] = useState<EnvFormMode>(null);
  const [envName, setEnvName] = useState('');
  const [envValue, setEnvValue] = useState('');
  const [envFormError, setEnvFormError] = useState('');

  async function load() {
    const rows = await api<Agent[]>('/agents');
    setAgents(rows);
  }

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : t('common.error'))); }, [t]);

  function openCreate() {
    setName('');
    setTransport('ws');
    setFormError('');
    setCreatedToken('');
    setOpen(true);
  }

  async function create() {
    setFormError('');
    setSaving(true);
    try {
      const res = await api<Agent>('/agents', { method: 'POST', body: JSON.stringify({ name, transport }) });
      setCreatedToken(res.token || '');
      setName('');
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  function openEdit(a: Agent) {
    const keys = [...(a.envKeys || [])].sort();
    setEditAgent(a);
    setEditTab('labels');
    setEditLabels((a.labels || []).join(', '));
    setInitialEnvKeys(keys);
    setDraftEnvKeys(keys);
    setEnvUpsert({});
    setEnvDelete([]);
    setEditError('');
    setEnvMode(null);
    setEnvName('');
    setEnvValue('');
    setEnvFormError('');
  }

  function closeEdit() {
    setEditAgent(null);
    setEnvMode(null);
  }

  async function saveAll() {
    if (!editAgent) return;
    setEditSaving(true);
    setEditError('');
    try {
      const labels = parseLabels(editLabels);
      const body: {
        labels: string[];
        envUpsert?: Record<string, string>;
        envDelete?: string[];
      } = { labels };
      if (Object.keys(envUpsert).length) body.envUpsert = envUpsert;
      if (envDelete.length) body.envDelete = envDelete;
      await api(`/agents/${editAgent.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      closeEdit();
      await load();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setEditSaving(false);
    }
  }

  function openEnvCreate() {
    setEnvMode('create');
    setEnvName('');
    setEnvValue('');
    setEnvFormError('');
  }

  function openEnvEdit(key: string) {
    setEnvMode('edit');
    setEnvName(key);
    setEnvValue(envUpsert[key] || '');
    setEnvFormError('');
  }

  function applyEnvDraft() {
    const key = envName.trim();
    if (!key) {
      setEnvFormError(t('agents.envNameRequired'));
      return;
    }
    if (envMode === 'create') {
      if (!envValue.trim()) {
        setEnvFormError(t('agents.envValueRequired'));
        return;
      }
      if (draftEnvKeys.includes(key) && !envDelete.includes(key)) {
        setEnvFormError(t('agents.envExists'));
        return;
      }
      setDraftEnvKeys((keys) => [...keys.filter((k) => k !== key), key].sort());
      setEnvUpsert((m) => ({ ...m, [key]: envValue }));
      setEnvDelete((d) => d.filter((k) => k !== key));
      setEnvMode(null);
      return;
    }
    // edit
    if (envValue.trim()) {
      setEnvUpsert((m) => ({ ...m, [key]: envValue }));
    }
    // blank = keep existing server value (or previous draft upsert)
    setEnvMode(null);
  }

  function deleteEnvDraft(key: string) {
    if (!window.confirm(t('agents.envDeleteConfirm', { name: key }))) return;
    setDraftEnvKeys((keys) => keys.filter((k) => k !== key));
    setEnvUpsert((m) => {
      const next = { ...m };
      delete next[key];
      return next;
    });
    if (initialEnvKeys.includes(key)) {
      setEnvDelete((d) => (d.includes(key) ? d : [...d, key]));
    }
    if (envMode === 'edit' && envName === key) setEnvMode(null);
  }

  return (
    <div className="sd-page sd-page-compact">
      <PageHeader
        title={t('agents.title')}
        actions={<Button onClick={openCreate}>{t('agents.create')}</Button>}
      />
      {error ? <Alert>{error}</Alert> : null}
      {createdToken && !open ? (
        <Alert tone="warn">{t('agents.tokenOnce')}: <code>{createdToken}</code></Alert>
      ) : null}

      {agents.length === 0 ? <EmptyState>{t('dashboard.noAgents')}</EmptyState> : null}

      {agents.length > 0 ? (
        <div className="sd-entity-list">
          {agents.map((a) => {
            const transportLabel = a.transport === 'grpc' ? 'gRPC' : a.transport === 'ws' ? 'WebSocket' : a.transport;
            const metaBits = [
              a.agentVersion ? `${t('agents.version')} ${a.agentVersion}` : null,
              `${t('agents.transport')} ${transportLabel}`,
              `${t('agents.protocol')} ${a.protocolVersion ?? '—'}`,
              a.meta?.containers != null ? `${a.meta.containers} containers` : null,
              a.meta?.danglingImages != null ? `${a.meta.danglingImages} dangling` : null,
              a.meta?.diskUsedBytes != null
                ? `disk ${(a.meta.diskUsedBytes / (1024 ** 3)).toFixed(1)} GiB`
                : null,
              (a.envKeys?.length)
                ? `${a.envKeys.length} ${t('agents.envCount')}`
                : null,
            ].filter(Boolean);
            const labels = a.labels || [];
            return (
              <Panel key={a.id} className="sd-entity-card">
                <div className="sd-entity-item">
                  <div className="sd-entity-main">
                    <div className="sd-entity-top">
                      <strong className="sd-entity-name">{a.name}</strong>
                      <span
                        className="sd-entity-status"
                        style={{ color: a.online ? '#3dd68c' : 'var(--sd-muted)' }}
                      >
                        {a.online ? t('agents.online') : (a.status ? tt(t, 'status', a.status) : t('agents.offline'))}
                      </span>
                    </div>
                    <div className="sd-entity-meta">{metaBits.join(' · ')}</div>
                    <div className="sd-chip-row" aria-label={t('agents.labels')} style={{ marginTop: 8 }}>
                      {labels.length === 0 ? (
                        <span className="sd-entity-muted">{t('agents.noLabels')}</span>
                      ) : (
                        labels.map((label) => (
                          <span key={label} className="sd-chip">{label}</span>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="sd-entity-actions">
                    <IconButton label={t('common.edit')} onClick={() => openEdit(a)}>
                      <IconEdit />
                    </IconButton>
                    <IconButton
                      label={t('agents.remove')}
                      tone="danger"
                      onClick={async () => {
                        await api(`/agents/${a.id}`, { method: 'DELETE' });
                        await load();
                      }}
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
        open={open}
        title={t('agents.create')}
        onClose={() => setOpen(false)}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            {!createdToken ? (
              <Button disabled={!name.trim() || saving} onClick={() => { void create(); }}>
                {saving ? t('common.loading') : t('common.create')}
              </Button>
            ) : (
              <Button onClick={() => setOpen(false)}>{t('common.close')}</Button>
            )}
          </>
        )}
      >
        {formError ? <Alert>{formError}</Alert> : null}
        {createdToken ? (
          <Alert tone="warn">{t('agents.tokenOnce')}: <code style={{ wordBreak: 'break-all' }}>{createdToken}</code></Alert>
        ) : (
          <div className="sd-stack">
            <Field label={t('agents.name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <Field label="Transport">
              <Select value={transport} onChange={(e) => setTransport(e.target.value)}>
                <option value="ws">WebSocket</option>
                <option value="grpc">gRPC</option>
              </Select>
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(editAgent)}
        title={editAgent ? `${t('common.edit')}: ${editAgent.name}` : t('common.edit')}
        onClose={closeEdit}
        wide
        footer={(
          <>
            <Button variant="ghost" onClick={closeEdit}>{t('common.cancel')}</Button>
            <Button disabled={editSaving} onClick={() => { void saveAll(); }}>
              {editSaving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        )}
      >
        {editError ? <Alert>{editError}</Alert> : null}
        <Tabs
          value={editTab}
          onChange={(id) => {
            setEditTab(id as EditTab);
            setEnvMode(null);
          }}
          items={[
            { id: 'labels', label: t('agents.labels') },
            { id: 'env', label: t('agents.env'), count: draftEnvKeys.length || undefined },
          ]}
        />

        {editTab === 'labels' ? (
          <div className="sd-stack" style={{ marginTop: 16 }}>
            <Field label={t('agents.labels')}>
              <Input
                value={editLabels}
                placeholder={t('agents.labelsPlaceholder')}
                onChange={(e) => setEditLabels(e.target.value)}
                autoFocus
              />
            </Field>
          </div>
        ) : (
          <div style={{ marginTop: 16 }}>
            <div className="sd-secrets-section-head">
              <div className="sd-entity-muted" style={{ fontSize: 12 }}>
                {t('agents.envHint')}
              </div>
              {envMode === null ? (
                <Button variant="ghost" className="sd-btn-sm" onClick={openEnvCreate}>
                  + {t('agents.addEnv')}
                </Button>
              ) : (
                <Button variant="ghost" className="sd-btn-sm" onClick={() => setEnvMode(null)}>
                  ← {t('agents.showEnv')}
                </Button>
              )}
            </div>

            {envMode !== null ? (
              <div className="sd-stack" style={{ marginTop: 12 }}>
                {envFormError ? <Alert>{envFormError}</Alert> : null}
                <Field label={t('secrets.name')}>
                  <Input
                    value={envName}
                    disabled={envMode === 'edit'}
                    placeholder={t('secrets.name')}
                    onChange={(e) => setEnvName(e.target.value)}
                    autoFocus
                    autoComplete="off"
                  />
                </Field>
                <Field label={t('secrets.value')}>
                  <Input
                    type="text"
                    value={envValue}
                    placeholder={envMode === 'edit' ? t('secrets.leaveBlank') : t('secrets.value')}
                    onChange={(e) => setEnvValue(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                {envMode === 'edit' ? (
                  <div style={{ fontSize: 12, color: 'var(--sd-muted)' }}>{t('secrets.valueKeepHint')}</div>
                ) : null}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="ghost" onClick={() => setEnvMode(null)}>{t('common.cancel')}</Button>
                  <Button onClick={applyEnvDraft}>
                    {envMode === 'create' ? t('agents.addEnv') : t('common.save')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="sd-secret-list" style={{ marginTop: 12 }}>
                {draftEnvKeys.length === 0 ? (
                  <div className="sd-entity-muted">{t('agents.noEnv')}</div>
                ) : (
                  draftEnvKeys.map((key) => (
                    <div key={key} className="sd-secret-row">
                      <strong className="sd-secret-name">{key}</strong>
                      <div className="sd-entity-actions">
                        <IconButton label={t('common.edit')} onClick={() => openEnvEdit(key)}>
                          <IconEdit />
                        </IconButton>
                        <IconButton
                          label={t('common.delete')}
                          tone="danger"
                          onClick={() => deleteEnvDraft(key)}
                        >
                          <IconTrash />
                        </IconButton>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
