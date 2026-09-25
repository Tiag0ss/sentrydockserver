'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import {
  PageHeader, Button, Input, Textarea, Field, Panel, EmptyState, Modal, Alert,
} from '@/components/ui';
import { IconButton, IconTrash } from '@/components/IconActions';

export default function TemplatesPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Array<{ id: string; key: string; name: string; body: string; builtin: boolean }>>([]);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [body, setBody] = useState('{"text":"Hello {{containerName}}"}');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() { setRows(await api('/templates')); }
  useEffect(() => { void load(); }, []);

  function openCreate() {
    setKey('');
    setName('');
    setBody('{"text":"Hello {{containerName}}"}');
    setFormError('');
    setOpen(true);
  }

  async function create() {
    setFormError('');
    setSaving(true);
    try {
      await api('/templates', { method: 'POST', body: JSON.stringify({ key, name, body }) });
      setOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sd-page sd-page-compact">
      <PageHeader
        title={t('templates.title')}
        actions={<Button onClick={openCreate}>{t('templates.create')}</Button>}
      />
      {rows.length === 0 ? <EmptyState>—</EmptyState> : (
        <div className="sd-entity-list">
          {rows.map((r) => (
            <Panel key={r.id} className="sd-entity-card">
              <div className="sd-entity-item">
                <div className="sd-entity-main">
                  <div className="sd-entity-top">
                    <strong className="sd-entity-name">{r.name}</strong>
                    <code className="sd-entity-muted">{r.key}</code>
                    {r.builtin ? (
                      <span className="sd-entity-badge" style={{ color: 'var(--sd-muted)' }}>
                        {t('templates.builtin')}
                      </span>
                    ) : null}
                  </div>
                  <div className="sd-entity-meta sd-entity-meta-wrap" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {r.body}
                  </div>
                </div>
                {!r.builtin ? (
                  <div className="sd-entity-actions">
                    <IconButton
                      label={t('common.delete')}
                      tone="danger"
                      onClick={async () => { await api(`/templates/${r.id}`, { method: 'DELETE' }); await load(); }}
                    >
                      <IconTrash />
                    </IconButton>
                  </div>
                ) : null}
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Modal
        open={open}
        title={t('templates.create')}
        onClose={() => setOpen(false)}
        wide
        footer={(
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button disabled={!key.trim() || !name.trim() || saving} onClick={() => { void create(); }}>
              {saving ? t('common.loading') : t('common.create')}
            </Button>
          </>
        )}
      >
        {formError ? <Alert>{formError}</Alert> : null}
        <div className="sd-stack">
          <Field label={t('templates.key')}><Input value={key} onChange={(e) => setKey(e.target.value)} autoFocus /></Field>
          <Field label={t('templates.name')}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Body"><Textarea value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  );
}
