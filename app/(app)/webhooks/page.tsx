'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import {
  PageHeader, Button, Input, Select, Field, Panel, Alert, EmptyState, Modal,
} from '@/components/ui';

export default function WebhooksPage() {
  const { t } = useI18n();
  const [hooks, setHooks] = useState<Array<{ id: string; name: string; flowId: string }>>([]);
  const [flows, setFlows] = useState<Array<{ id: string; name: string }>>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [flowId, setFlowId] = useState('');
  const [created, setCreated] = useState<{ url: string; token: string } | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      setHooks(await api('/webhook-triggers'));
      setFlows(await api('/flows'));
    })();
  }, []);

  function openCreate() {
    setName('');
    setFlowId(flows[0]?.id || '');
    setCreated(null);
    setFormError('');
    setOpen(true);
  }

  async function create() {
    setFormError('');
    setSaving(true);
    try {
      const res = await api<{ id: string; url: string; token: string }>('/webhook-triggers', {
        method: 'POST',
        body: JSON.stringify({ name, flowId }),
      });
      setCreated(res);
      setHooks(await api('/webhook-triggers'));
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sd-page sd-page-compact">
      <PageHeader
        title={t('webhooks.title')}
        actions={<Button onClick={openCreate}>{t('webhooks.create')}</Button>}
      />
      {hooks.length === 0 ? <EmptyState>—</EmptyState> : (
        <div className="sd-entity-list">
          {hooks.map((h) => (
            <Panel key={h.id} className="sd-entity-card">
              <div className="sd-entity-item">
                <div className="sd-entity-main">
                  <div className="sd-entity-top">
                    <strong className="sd-entity-name">{h.name}</strong>
                  </div>
                  <div className="sd-entity-meta">
                    flow {h.flowId.slice(0, 8)}… · /api/hooks/{h.id}
                  </div>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Modal
        open={open}
        title={t('webhooks.create')}
        onClose={() => setOpen(false)}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            {!created ? (
              <Button disabled={!name.trim() || !flowId || saving} onClick={() => { void create(); }}>
                {saving ? t('common.loading') : t('common.create')}
              </Button>
            ) : (
              <Button onClick={() => setOpen(false)}>{t('common.close')}</Button>
            )}
          </>
        )}
      >
        {formError ? <Alert>{formError}</Alert> : null}
        {created ? (
          <Alert tone="warn">
            <div>POST {created.url}</div>
            <div>Header X-SentryDock-Token: <code style={{ wordBreak: 'break-all' }}>{created.token}</code></div>
          </Alert>
        ) : (
          <div className="sd-stack">
            <Field label={t('webhooks.name')}><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
            <Field label={t('webhooks.flow')}>
              <Select value={flowId} onChange={(e) => setFlowId(e.target.value)}>
                <option value="">{t('webhooks.flow')}</option>
                {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
