'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import {
  PageHeader, Button, Input, Select, Field, Alert, EmptyState, DataRow, Panel, Badge, Modal,
} from '@/components/ui';
import { IconButton, IconTrash, IconSave } from '@/components/IconActions';

type Agent = {
  id: string;
  name: string;
  status: string;
  online: boolean;
  transport: string;
  protocolVersion: number | null;
  token?: string;
  labels?: string[];
  meta?: {
    containers?: number;
    danglingImages?: number;
    diskUsedBytes?: number;
    diskTotalBytes?: number;
  } | null;
};

export default function AgentsPage() {
  const { t } = useI18n();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState('ws');
  const [createdToken, setCreatedToken] = useState('');
  const [labelDraft, setLabelDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const rows = await api<Agent[]>('/agents');
    setAgents(rows);
    const drafts: Record<string, string> = {};
    for (const a of rows) {
      drafts[a.id] = (a.labels || []).join(', ');
    }
    setLabelDraft(drafts);
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

  async function saveLabels(id: string) {
    const labels = (labelDraft[id] || '').split(',').map((s) => s.trim()).filter(Boolean);
    await api(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify({ labels }) });
    await load();
  }

  return (
    <div className="sd-page">
      <PageHeader
        title={t('agents.title')}
        actions={<Button onClick={openCreate}>{t('agents.create')}</Button>}
      />
      {error ? <Alert>{error}</Alert> : null}
      {createdToken && !open ? (
        <Alert tone="warn">{t('agents.tokenOnce')}: <code>{createdToken}</code></Alert>
      ) : null}

      {agents.length === 0 ? <EmptyState>{t('dashboard.noAgents')}</EmptyState> : null}
      {agents.map((a) => (
        <Panel key={a.id}>
          <DataRow
            title={(
              <>
                {a.name}{' '}
                <Badge tone={a.online ? 'ok' : undefined}>
                  {a.online ? t('agents.online') : (a.status ? tt(t, 'status', a.status) : t('agents.offline'))}
                </Badge>
              </>
            )}
            meta={`${a.transport} · ${t('agents.protocol')} ${a.protocolVersion ?? '—'} · ${a.id.slice(0, 8)}…`}
            actions={(
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
            )}
          >
            {a.meta ? (
              <div className="sd-row-meta" style={{ marginTop: 6 }}>
                {[
                  a.meta.containers != null ? `${a.meta.containers} containers` : null,
                  a.meta.danglingImages != null ? `${a.meta.danglingImages} dangling` : null,
                  a.meta.diskUsedBytes != null
                    ? `disk ${(a.meta.diskUsedBytes / (1024 ** 3)).toFixed(1)} GiB`
                    : null,
                ].filter(Boolean).join(' · ')}
              </div>
            ) : null}
            <div className="sd-form-row" style={{ marginTop: 10 }}>
              <Field label={t('agents.labels')}>
                <Input
                  placeholder={t('agents.labelsPlaceholder')}
                  value={labelDraft[a.id] || ''}
                  onChange={(e) => setLabelDraft((s) => ({ ...s, [a.id]: e.target.value }))}
                />
              </Field>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <IconButton label={t('agents.saveLabels')} tone="primary" onClick={() => { void saveLabels(a.id); }}>
                  <IconSave />
                </IconButton>
              </div>
            </div>
          </DataRow>
        </Panel>
      ))}

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
