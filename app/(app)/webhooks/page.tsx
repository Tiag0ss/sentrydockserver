'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import {
  PageHeader, Button, Input, Select, Field, Panel, Alert, EmptyState, Modal,
} from '@/components/ui';
import { IconButton, IconTrash, IconEdit, IconCopy, IconKey } from '@/components/IconActions';

type Hook = {
  id: string;
  name: string;
  flowId: string;
  flowName?: string | null;
  enabled: boolean;
  url?: string;
};

type FlowOpt = { id: string; name: string };

type ModalMode = 'create' | 'edit' | null;

export default function WebhooksPage() {
  const { t } = useI18n();
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [flows, setFlows] = useState<FlowOpt[]>([]);
  const [mode, setMode] = useState<ModalMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [flowId, setFlowId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [created, setCreated] = useState<{ url: string; token: string } | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const [h, f] = await Promise.all([
      api<Hook[]>('/webhook-triggers'),
      api<FlowOpt[]>('/flows'),
    ]);
    setHooks(h);
    setFlows(f);
  }, []);

  useEffect(() => {
    void load().catch((e) => setListError(e instanceof Error ? e.message : t('common.error')));
  }, [load, t]);

  function closeModal() {
    setMode(null);
    setEditingId(null);
    setCreated(null);
    setFormError('');
  }

  function openCreate() {
    setName('');
    setFlowId(flows[0]?.id || '');
    setEnabled(true);
    setCreated(null);
    setFormError('');
    setEditingId(null);
    setMode('create');
  }

  function openEdit(h: Hook) {
    setName(h.name);
    setFlowId(h.flowId);
    setEnabled(h.enabled !== false);
    setCreated(null);
    setFormError('');
    setEditingId(h.id);
    setMode('edit');
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
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!editingId) return;
    setFormError('');
    setSaving(true);
    try {
      await api(`/webhook-triggers/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, flowId, enabled }),
      });
      closeModal();
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  async function resetToken(id: string) {
    if (!window.confirm(t('webhooks.resetTokenConfirm'))) return;
    setFormError('');
    setSaving(true);
    try {
      const res = await api<{ id: string; url: string; token: string }>(
        `/webhook-triggers/${id}/reset-token`,
        { method: 'POST', body: '{}' },
      );
      setEditingId(id);
      setMode('edit');
      const h = hooks.find((x) => x.id === id);
      setName(h?.name || '');
      setFlowId(h?.flowId || '');
      setEnabled(h?.enabled !== false);
      setCreated(res);
      await load();
    } catch (e) {
      setListError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string, hookName: string) {
    if (!window.confirm(t('webhooks.deleteConfirm', { name: hookName }))) return;
    try {
      await api(`/webhook-triggers/${id}`, { method: 'DELETE' });
      if (editingId === id) closeModal();
      await load();
    } catch (e) {
      setListError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  const modalOpen = mode !== null;
  const showingToken = Boolean(created);

  return (
    <div className="sd-page sd-page-compact">
      <PageHeader
        title={t('webhooks.title')}
        actions={<Button onClick={openCreate}>{t('webhooks.create')}</Button>}
      />
      {listError ? <Alert>{listError}</Alert> : null}
      {hooks.length === 0 ? <EmptyState>{t('webhooks.empty')}</EmptyState> : (
        <div className="sd-entity-list">
          {hooks.map((h) => (
            <Panel key={h.id} className="sd-entity-card">
              <div className="sd-entity-item">
                <div className="sd-entity-main">
                  <div className="sd-entity-top">
                    <strong className="sd-entity-name">{h.name}</strong>
                    <span
                      className="sd-entity-status"
                      style={{ color: h.enabled ? 'var(--sd-ok)' : 'var(--sd-muted)' }}
                    >
                      {h.enabled ? t('webhooks.enabled') : t('webhooks.disabled')}
                    </span>
                  </div>
                  <div className="sd-entity-meta sd-entity-meta-wrap">
                    {h.flowName || h.flowId.slice(0, 8)}
                    {' · '}
                    <code style={{ fontSize: '0.85em' }}>/api/hooks/{h.id}</code>
                  </div>
                </div>
                <div className="sd-entity-actions">
                  <IconButton label={t('webhooks.edit')} onClick={() => openEdit(h)}>
                    <IconEdit />
                  </IconButton>
                  <IconButton
                    label={t('webhooks.resetToken')}
                    tone="warn"
                    onClick={() => { void resetToken(h.id); }}
                  >
                    <IconKey />
                  </IconButton>
                  <IconButton
                    label={t('webhooks.delete')}
                    tone="danger"
                    onClick={() => { void remove(h.id, h.name); }}
                  >
                    <IconTrash />
                  </IconButton>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        title={mode === 'edit' ? t('webhooks.edit') : t('webhooks.create')}
        onClose={closeModal}
        footer={(
          <>
            <Button variant="ghost" onClick={closeModal}>
              {showingToken && mode === 'create' ? t('common.close') : t('common.cancel')}
            </Button>
            {!showingToken && mode === 'create' ? (
              <Button disabled={!name.trim() || !flowId || saving} onClick={() => { void create(); }}>
                {saving ? t('common.loading') : t('common.create')}
              </Button>
            ) : null}
            {!showingToken && mode === 'edit' ? (
              <Button disabled={!name.trim() || !flowId || saving} onClick={() => { void saveEdit(); }}>
                {saving ? t('common.loading') : t('common.save')}
              </Button>
            ) : null}
            {showingToken && mode === 'edit' ? (
              <Button onClick={closeModal}>{t('common.close')}</Button>
            ) : null}
          </>
        )}
      >
        {formError ? <Alert>{formError}</Alert> : null}
        {created ? (
          <Alert tone="warn">
            <div style={{ marginBottom: 8 }}>{t('webhooks.tokenOnce')}</div>
            <div>POST {created.url}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              <span>Header X-SentryDock-Token:</span>
              <code style={{ wordBreak: 'break-all' }}>{created.token}</code>
              <IconButton label={copied ? t('common.copied') : t('common.copy')} onClick={() => { void copyText(created.token); }}>
                <IconCopy />
              </IconButton>
            </div>
          </Alert>
        ) : (
          <div className="sd-stack">
            <Field label={t('webhooks.name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <Field label={t('webhooks.flow')}>
              <Select value={flowId} onChange={(e) => setFlowId(e.target.value)}>
                <option value="">{t('webhooks.flow')}</option>
                {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            </Field>
            {mode === 'edit' ? (
              <Field label={t('webhooks.status')}>
                <Select value={enabled ? '1' : '0'} onChange={(e) => setEnabled(e.target.value === '1')}>
                  <option value="1">{t('webhooks.enabled')}</option>
                  <option value="0">{t('webhooks.disabled')}</option>
                </Select>
              </Field>
            ) : null}
            {mode === 'edit' && editingId ? (
              <div className="sd-actions">
                <Button
                  variant="ghost"
                  disabled={saving}
                  onClick={() => { void resetToken(editingId); }}
                >
                  {t('webhooks.resetToken')}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
