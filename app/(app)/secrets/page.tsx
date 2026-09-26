'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import {
  PageHeader, Button, Input, Field, EmptyState, Modal, Alert,
} from '@/components/ui';
import { IconButton, IconTrash, IconEdit } from '@/components/IconActions';

type SecretType = 'generic_token' | 'header_secret' | 'registry_credentials';
type SecretRow = { id: string; name: string; type: string };

type ModalMode = 'create' | 'edit' | null;

const SECRET_TYPES: SecretType[] = ['generic_token', 'header_secret', 'registry_credentials'];

export default function SecretsPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<SecretRow[]>([]);
  const [mode, setMode] = useState<ModalMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<SecretType>('generic_token');
  const [name, setName] = useState('');
  const [type, setType] = useState<SecretType>('generic_token');
  const [value, setValue] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState('');
  const [formError, setFormError] = useState('');
  const [listError, setListError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() { setRows(await api('/secrets')); }
  useEffect(() => {
    void load().catch((e) => setListError(e instanceof Error ? e.message : t('common.error')));
  }, [t]);

  function resetForm() {
    setName('');
    setType('generic_token');
    setValue('');
    setUsername('');
    setPassword('');
    setServer('');
    setEditingId(null);
    setEditingType('generic_token');
    setFormError('');
  }

  function closeModal() {
    setMode(null);
    resetForm();
  }

  function openCreate() {
    resetForm();
    setMode('create');
  }

  function openEdit(r: SecretRow) {
    resetForm();
    setName(r.name);
    setEditingType((r.type as SecretType) || 'generic_token');
    setType((r.type as SecretType) || 'generic_token');
    setEditingId(r.id);
    setMode('edit');
  }

  function typeLabel(secretType: string) {
    if (secretType === 'registry_credentials') return t('secrets.typeRegistry');
    if (secretType === 'header_secret') return t('secrets.typeHeader');
    return t('secrets.typeToken');
  }

  async function create() {
    setFormError('');
    if (!name.trim()) {
      setFormError(t('secrets.nameRequired'));
      return;
    }
    let bodyValue: string | Record<string, string>;
    if (type === 'registry_credentials') {
      if (!username.trim() || !password.trim()) {
        setFormError(t('secrets.valueRequired'));
        return;
      }
      bodyValue = {
        username: username.trim(),
        password: password.trim(),
        ...(server.trim() ? { serveraddress: server.trim() } : {}),
      };
    } else {
      if (!value.trim()) {
        setFormError(t('secrets.valueRequired'));
        return;
      }
      bodyValue = value.trim();
    }
    setSaving(true);
    try {
      await api('/secrets', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          type,
          value: bodyValue,
        }),
      });
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
    if (!name.trim()) {
      setFormError(t('secrets.nameRequired'));
      return;
    }
    const body: { name: string; value?: string | Record<string, string> } = { name: name.trim() };
    if (editingType === 'registry_credentials') {
      if (username.trim() || password.trim() || server.trim()) {
        if (!username.trim() || !password.trim()) {
          setFormError(t('secrets.valueRequired'));
          return;
        }
        body.value = {
          username: username.trim(),
          password: password.trim(),
          ...(server.trim() ? { serveraddress: server.trim() } : {}),
        };
      }
    } else if (value.trim()) {
      body.value = value.trim();
    }
    setSaving(true);
    try {
      await api(`/secrets/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
      closeModal();
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string, secretName: string) {
    if (!window.confirm(t('secrets.deleteConfirm', { name: secretName }))) return;
    try {
      await api(`/secrets/${id}`, { method: 'DELETE' });
      if (editingId === id) closeModal();
      await load();
    } catch (e) {
      setListError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  const activeType = mode === 'edit' ? editingType : type;
  const canSubmitCreate = activeType === 'registry_credentials'
    ? Boolean(name.trim() && username.trim() && password.trim())
    : Boolean(name.trim() && value.trim());
  const canSubmitEdit = Boolean(name.trim());

  return (
    <div className="sd-page sd-page-compact">
      <PageHeader
        title={t('secrets.title')}
        subtitle={t('secrets.subtitle')}
        actions={(
          <Button variant="ghost" onClick={openCreate}>
            + {t('secrets.create')}
          </Button>
        )}
      />
      {listError ? <Alert>{listError}</Alert> : null}
      {rows.length === 0 ? <EmptyState>{t('secrets.empty')}</EmptyState> : (
        <div className="sd-secret-list">
          {rows.map((r) => (
            <div key={r.id} className="sd-secret-row">
              <div className="sd-secret-main">
                <strong className="sd-secret-name">{r.name}</strong>
                <span className="sd-chip">{typeLabel(r.type)}</span>
                {r.type !== 'registry_credentials' ? (
                  <span className="sd-chip sd-chip-muted">{t('secrets.composeEnvChip')}</span>
                ) : null}
              </div>
              <div className="sd-entity-actions">
                <IconButton label={t('secrets.edit')} onClick={() => openEdit(r)}>
                  <IconEdit />
                </IconButton>
                <IconButton
                  label={t('secrets.delete')}
                  tone="danger"
                  onClick={() => { void remove(r.id, r.name); }}
                >
                  <IconTrash />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={mode !== null}
        title={mode === 'edit' ? t('secrets.edit') : t('secrets.create')}
        onClose={closeModal}
        footer={(
          <>
            <Button variant="ghost" onClick={closeModal}>{t('common.cancel')}</Button>
            {mode === 'create' ? (
              <Button disabled={!canSubmitCreate || saving} onClick={() => { void create(); }}>
                {saving ? t('common.loading') : t('secrets.addSecret')}
              </Button>
            ) : (
              <Button disabled={!canSubmitEdit || saving} onClick={() => { void saveEdit(); }}>
                {saving ? t('common.loading') : t('common.save')}
              </Button>
            )}
          </>
        )}
      >
        {formError ? <Alert>{formError}</Alert> : null}
        <div className="sd-stack">
          {mode === 'create' ? (
            <Field label={t('secrets.type')}>
              <select
                className="sd-input"
                value={type}
                onChange={(e) => setType(e.target.value as SecretType)}
              >
                {SECRET_TYPES.map((st) => (
                  <option key={st} value={st}>{typeLabel(st)}</option>
                ))}
              </select>
            </Field>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--sd-muted)' }}>
              {t('secrets.type')}: {typeLabel(editingType)}
            </div>
          )}
          <Field label={t('secrets.name')}>
            <Input
              value={name}
              placeholder={t('secrets.name')}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              autoComplete="off"
            />
          </Field>
          {activeType === 'registry_credentials' ? (
            <>
              <Field label={t('secrets.username')}>
                <Input
                  value={username}
                  placeholder={mode === 'edit' ? t('secrets.leaveBlank') : t('secrets.username')}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('secrets.passwordToken')}>
                <Input
                  type="text"
                  value={password}
                  placeholder={mode === 'edit' ? t('secrets.leaveBlank') : t('secrets.passwordToken')}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('secrets.serverOptional')}>
                <Input
                  value={server}
                  placeholder="ghcr.io"
                  onChange={(e) => setServer(e.target.value)}
                  autoComplete="off"
                />
              </Field>
            </>
          ) : (
            <Field label={t('secrets.value')}>
              <Input
                type="text"
                value={value}
                placeholder={mode === 'edit' ? t('secrets.leaveBlank') : t('secrets.value')}
                onChange={(e) => setValue(e.target.value)}
                autoComplete="off"
              />
            </Field>
          )}
          {mode === 'edit' ? (
            <div style={{ fontSize: 12, color: 'var(--sd-muted)' }}>{t('secrets.valueKeepHint')}</div>
          ) : activeType !== 'registry_credentials' ? (
            <div style={{ fontSize: 12, color: 'var(--sd-muted)' }}>{t('secrets.composeEnvHint')}</div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
