'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import { PageHeader, Button, Input, Select, Field, Alert, EmptyState, DataRow, Panel, Badge } from '@/components/ui';

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
  const [name, setName] = useState('');
  const [transport, setTransport] = useState('ws');
  const [createdToken, setCreatedToken] = useState('');
  const [labelDraft, setLabelDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

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

  async function create() {
    setError('');
    try {
      const res = await api<Agent>('/agents', { method: 'POST', body: JSON.stringify({ name, transport }) });
      setCreatedToken(res.token || '');
      setName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  async function saveLabels(id: string) {
    const labels = (labelDraft[id] || '').split(',').map((s) => s.trim()).filter(Boolean);
    await api(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify({ labels }) });
    await load();
  }

  return (
    <div className="sd-page">
      <PageHeader title={t('agents.title')} />
      {error ? <Alert>{error}</Alert> : null}
      {createdToken ? (
        <Alert tone="warn">{t('agents.tokenOnce')}: <code>{createdToken}</code></Alert>
      ) : null}

      <Panel>
        <div className="sd-form-row">
          <Field label={t('agents.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('agents.name')} />
          </Field>
          <Field label="Transport">
            <Select value={transport} onChange={(e) => setTransport(e.target.value)}>
              <option value="ws">WebSocket</option>
              <option value="grpc">gRPC</option>
            </Select>
          </Field>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button onClick={() => { void create(); }} disabled={!name.trim()}>{t('agents.create')}</Button>
          </div>
        </div>
      </Panel>

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
              <Button
                variant="danger"
                onClick={async () => {
                  await api(`/agents/${a.id}`, { method: 'DELETE' });
                  await load();
                }}
              >
                {t('agents.remove')}
              </Button>
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
                <Button onClick={() => { void saveLabels(a.id); }}>{t('agents.saveLabels')}</Button>
              </div>
            </div>
          </DataRow>
        </Panel>
      ))}
    </div>
  );
}
