'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import {
  PageHeader, Button, Input, Select, Field, Alert, EmptyState, Panel, Modal,
} from '@/components/ui';
import { IconButton, IconTrash, IconSave, IconEdit } from '@/components/IconActions';

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
  meta?: {
    containers?: number;
    danglingImages?: number;
    diskUsedBytes?: number;
    diskTotalBytes?: number;
  } | null;
};

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
  const [editingLabels, setEditingLabels] = useState<Record<string, boolean>>({});
  const [labelDraft, setLabelDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingLabelsId, setSavingLabelsId] = useState<string | null>(null);

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

  function startEditLabels(a: Agent) {
    setLabelDraft((s) => ({ ...s, [a.id]: (a.labels || []).join(', ') }));
    setEditingLabels((s) => ({ ...s, [a.id]: true }));
  }

  function cancelEditLabels(id: string) {
    setEditingLabels((s) => ({ ...s, [id]: false }));
  }

  async function saveLabels(id: string) {
    setSavingLabelsId(id);
    try {
      const labels = parseLabels(labelDraft[id] || '');
      await api(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify({ labels }) });
      setEditingLabels((s) => ({ ...s, [id]: false }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSavingLabelsId(null);
    }
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
            ].filter(Boolean);
            const labels = a.labels || [];
            const isEditing = Boolean(editingLabels[a.id]);
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
                    <div className="sd-agent-labels">
                      {isEditing ? (
                        <div className="sd-agent-labels-edit">
                          <Field label={t('agents.labels')}>
                            <Input
                              className="sd-input sd-input-sm"
                              placeholder={t('agents.labelsPlaceholder')}
                              value={labelDraft[a.id] || ''}
                              autoFocus
                              onChange={(e) => setLabelDraft((s) => ({ ...s, [a.id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  void saveLabels(a.id);
                                }
                                if (e.key === 'Escape') cancelEditLabels(a.id);
                              }}
                            />
                          </Field>
                          <div className="sd-agent-labels-edit-actions">
                            <IconButton
                              label={t('agents.saveLabels')}
                              tone="primary"
                              disabled={savingLabelsId === a.id}
                              onClick={() => { void saveLabels(a.id); }}
                            >
                              <IconSave />
                            </IconButton>
                            <Button
                              variant="ghost"
                              className="sd-btn-sm"
                              onClick={() => cancelEditLabels(a.id)}
                            >
                              {t('common.cancel')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="sd-agent-labels-view">
                          <div className="sd-chip-row" aria-label={t('agents.labels')}>
                            {labels.length === 0 ? (
                              <span className="sd-entity-muted">{t('agents.noLabels')}</span>
                            ) : (
                              labels.map((label) => (
                                <span key={label} className="sd-chip">{label}</span>
                              ))
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            className="sd-btn-sm sd-agent-labels-edit-btn"
                            onClick={() => startEditLabels(a)}
                          >
                            <IconEdit />
                            {t('agents.editLabels')}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="sd-entity-actions">
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
    </div>
  );
}
