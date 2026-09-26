'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import {
  PageHeader, Button, Input, Field, Panel, EmptyState, Modal, Alert,
} from '@/components/ui';
import { IconButton, IconTrash, IconEdit, IconSave } from '@/components/IconActions';

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

  function openCreate() {
    setEditingId(null);
    setName('');
    setYamlText(DEFAULT_YAML);
    setFormError('');
    setOpen(true);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        title={t('compose.title')}
        subtitle={t('compose.subtitle')}
        actions={<Button onClick={openCreate}>{t('compose.create')}</Button>}
      />
      {error ? <Alert>{error}</Alert> : null}

      {projects.length === 0 ? (
        <EmptyState>{t('compose.empty')}</EmptyState>
      ) : (
        projects.map((p) => (
          <Panel key={p.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              <div>
                <strong style={{ fontSize: 16 }}>{p.name}</strong>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  hash {p.contentHash.slice(0, 12)}…
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Button variant="ghost" onClick={() => openDeploy(p)}>{t('compose.deploy')}</Button>
                <Button variant="ghost" onClick={() => void runCheck(p.id)}>{t('compose.check')}</Button>
                <IconButton label={t('common.edit')} onClick={() => openEdit(p)}><IconEdit /></IconButton>
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
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setDeployId(null)}>{t('common.cancel')}</Button>
            <Button onClick={() => void runDeploy()} disabled={deployBusy}>
              {deployBusy ? t('compose.deploying') : t('compose.deploy')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
