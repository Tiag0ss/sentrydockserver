'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import {
  PageHeader, Button, Input, Textarea, Field, Panel, EmptyState, Modal, Alert,
} from '@/components/ui';
import { IconButton, IconTrash, IconEdit } from '@/components/IconActions';
import { TEMPLATE_TAGS } from '../flows/_components/flowConstants';

type TemplateRow = {
  id: string;
  key: string;
  name: string;
  body: string;
  builtin: boolean;
};

type ModalMode = 'create' | 'edit' | null;

export default function TemplatesPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [mode, setMode] = useState<ModalMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBuiltin, setEditingBuiltin] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState('');
  const [listError, setListError] = useState('');
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  async function load() { setRows(await api('/templates')); }
  useEffect(() => {
    void load().catch((e) => setListError(e instanceof Error ? e.message : t('common.error')));
  }, [t]);

  function closeModal() {
    setMode(null);
    setEditingId(null);
    setEditingBuiltin(false);
    setFormError('');
  }

  function openCreate() {
    setKey('');
    setName('');
    setBody('Actualização em {{containerName}} ({{agentName}}): {{image}}');
    setEditingId(null);
    setEditingBuiltin(false);
    setFormError('');
    setMode('create');
  }

  function openEdit(r: TemplateRow) {
    setKey(r.key);
    setName(r.name);
    setBody(r.body);
    setEditingId(r.id);
    setEditingBuiltin(Boolean(r.builtin));
    setFormError('');
    setMode('edit');
  }

  function insertTag(tag: string) {
    const token = `{{${tag}}}`;
    const el = bodyRef.current;
    if (!el) {
      setBody((prev) => (prev ? `${prev}${prev.endsWith(' ') ? '' : ' '}${token}` : token));
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${token}${body.slice(end)}`;
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function create() {
    setFormError('');
    setSaving(true);
    try {
      await api('/templates', { method: 'POST', body: JSON.stringify({ key, name, body }) });
      closeModal();
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
      const payload: { name: string; body: string; key?: string } = { name, body };
      if (!editingBuiltin) payload.key = key;
      await api(`/templates/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) });
      closeModal();
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string, templateName: string) {
    if (!window.confirm(t('templates.deleteConfirm', { name: templateName }))) return;
    try {
      await api(`/templates/${id}`, { method: 'DELETE' });
      if (editingId === id) closeModal();
      await load();
    } catch (e) {
      setListError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  const canSubmit = Boolean(key.trim() && name.trim() && body.trim());

  return (
    <div className="sd-page sd-page-compact">
      <PageHeader
        title={t('templates.title')}
        subtitle={t('templates.subtitle')}
        actions={<Button onClick={openCreate}>{t('templates.create')}</Button>}
      />
      {listError ? <Alert>{listError}</Alert> : null}
      {rows.length === 0 ? <EmptyState>{t('templates.empty')}</EmptyState> : (
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
                <div className="sd-entity-actions">
                  <IconButton label={t('templates.edit')} onClick={() => openEdit(r)}>
                    <IconEdit />
                  </IconButton>
                  {!r.builtin ? (
                    <IconButton
                      label={t('common.delete')}
                      tone="danger"
                      onClick={() => { void remove(r.id, r.name); }}
                    >
                      <IconTrash />
                    </IconButton>
                  ) : null}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Modal
        open={mode !== null}
        title={mode === 'edit' ? t('templates.edit') : t('templates.create')}
        onClose={closeModal}
        wide
        className="sd-modal-xl"
        footer={(
          <>
            <Button variant="ghost" onClick={closeModal}>{t('common.cancel')}</Button>
            {mode === 'create' ? (
              <Button disabled={!canSubmit || saving} onClick={() => { void create(); }}>
                {saving ? t('common.loading') : t('common.create')}
              </Button>
            ) : (
              <Button disabled={!canSubmit || saving} onClick={() => { void saveEdit(); }}>
                {saving ? t('common.loading') : t('common.save')}
              </Button>
            )}
          </>
        )}
      >
        {formError ? <Alert>{formError}</Alert> : null}
        <div className="sd-template-editor">
          <div className="sd-template-editor-form">
            <Field label={t('templates.key')}>
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoFocus={mode === 'create'}
                disabled={editingBuiltin}
              />
            </Field>
            <Field label={t('templates.name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus={mode === 'edit'} />
            </Field>
            <Field label={t('templates.body')}>
              <Textarea
                ref={bodyRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="sd-textarea"
              />
            </Field>
            <div style={{ fontSize: 12, color: 'var(--sd-muted)' }}>{t('templates.bodyHint')}</div>
          </div>
          <aside className="sd-template-tags" aria-label={t('templates.tagsTitle')}>
            <div className="sd-template-tags-head">
              <strong>{t('templates.tagsTitle')}</strong>
              <span>{t('templates.tagsHint')}</span>
            </div>
            <div className="sd-template-tags-list">
              {TEMPLATE_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="sd-template-tag"
                  onClick={() => insertTag(tag)}
                  title={`{{${tag}}}`}
                >
                  <code>{`{{${tag}}}`}</code>
                  <span>{tt(t, 'templateTags', tag)}</span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      </Modal>
    </div>
  );
}
