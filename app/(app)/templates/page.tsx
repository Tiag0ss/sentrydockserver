'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import {
  PageHeader, Button, Input, Textarea, Field, Panel, DataRow, Badge, EmptyState, Modal, Alert,
} from '@/components/ui';

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
    <div className="sd-page">
      <PageHeader
        title={t('templates.title')}
        actions={<Button onClick={openCreate}>{t('templates.create')}</Button>}
      />
      {rows.length === 0 ? <EmptyState>—</EmptyState> : (
        <Panel>
          {rows.map((r) => (
            <DataRow
              key={r.id}
              title={(
                <>
                  {r.name} <code style={{ fontSize: 12, color: 'var(--sd-muted)' }}>{r.key}</code>
                  {r.builtin ? <> {' '}<Badge>{t('templates.builtin')}</Badge></> : null}
                </>
              )}
              meta={<pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', fontFamily: 'IBM Plex Mono, monospace' }}>{r.body}</pre>}
              actions={!r.builtin ? (
                <Button variant="danger" onClick={async () => { await api(`/templates/${r.id}`, { method: 'DELETE' }); await load(); }}>
                  {t('common.delete')}
                </Button>
              ) : undefined}
            />
          ))}
        </Panel>
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
