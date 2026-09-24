'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { PageHeader, Button, Input, Select, Field, Panel, DataRow, Alert, EmptyState } from '@/components/ui';

export default function WebhooksPage() {
  const { t } = useI18n();
  const [hooks, setHooks] = useState<Array<{ id: string; name: string; flowId: string }>>([]);
  const [flows, setFlows] = useState<Array<{ id: string; name: string }>>([]);
  const [name, setName] = useState('');
  const [flowId, setFlowId] = useState('');
  const [created, setCreated] = useState<{ url: string; token: string } | null>(null);

  useEffect(() => {
    void (async () => {
      setHooks(await api('/webhook-triggers'));
      setFlows(await api('/flows'));
    })();
  }, []);

  async function create() {
    const res = await api<{ id: string; url: string; token: string }>('/webhook-triggers', {
      method: 'POST',
      body: JSON.stringify({ name, flowId }),
    });
    setCreated(res);
    setHooks(await api('/webhook-triggers'));
  }

  return (
    <div className="sd-page">
      <PageHeader title={t('webhooks.title')} />
      <Panel>
        <div className="sd-form-row">
          <Field label={t('webhooks.name')}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t('webhooks.flow')}>
            <Select value={flowId} onChange={(e) => setFlowId(e.target.value)}>
              <option value="">{t('webhooks.flow')}</option>
              {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button onClick={() => { void create(); }} disabled={!name || !flowId}>{t('webhooks.create')}</Button>
          </div>
        </div>
      </Panel>
      {created ? (
        <Alert tone="warn">
          <div>POST {created.url}</div>
          <div>Header X-SentryDock-Token: <code>{created.token}</code></div>
        </Alert>
      ) : null}
      {hooks.length === 0 ? <EmptyState>—</EmptyState> : (
        <Panel>
          {hooks.map((h) => (
            <DataRow
              key={h.id}
              title={h.name}
              meta={`flow ${h.flowId.slice(0, 8)}… · /api/hooks/${h.id}`}
            />
          ))}
        </Panel>
      )}
    </div>
  );
}
