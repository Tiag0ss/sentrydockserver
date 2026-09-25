'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import {
  PageHeader, Button, Input, Select, Field, Panel, EmptyState, Modal, Alert,
} from '@/components/ui';
import { IconButton, IconTrash, IconEdit } from '@/components/IconActions';

type SecretRow = { id: string; name: string; type: string };

type ModalMode = 'create' | 'edit' | null;

export default function SecretsPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<SecretRow[]>([]);
  const [mode, setMode] = useState<ModalMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState('registry_credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serveraddress, setServeraddress] = useState('');
  const [formError, setFormError] = useState('');
  const [listError, setListError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() { setRows(await api('/secrets')); }
  useEffect(() => {
    void load().catch((e) => setListError(e instanceof Error ? e.message : t('common.error')));
  }, [t]);

  function closeModal() {
    setMode(null);
    setEditingId(null);
    setFormError('');
  }

  function resetFields() {
    setName('');
    setType('registry_credentials');
    setUsername('');
    setPassword('');
    setServeraddress('');
  }

  function openCreate() {
    resetFields();
    setEditingId(null);
    setFormError('');
    setMode('create');
  }

  function openEdit(r: SecretRow) {
    setName(r.name);
    setType(r.type);
    setUsername('');
    setPassword('');
    setServeraddress('');
    setEditingId(r.id);
    setFormError('');
    setMode('edit');
  }

  function buildValue(forEdit: boolean): string | Record<string, unknown> | null {
    if (type === 'registry_credentials') {
      if (forEdit) {
        // Só roda o valor se houver password nova (campos vazios = manter).
        if (!password) return null;
        return { username, password, serveraddress };
      }
      if (!username.trim() || !password) return null;
      return { username, password, serveraddress };
    }
    const v = password.trim();
    return v || null;
  }

  async function create() {
    setFormError('');
    const value = buildValue(false);
    if (!value) {
      setFormError(t('secrets.valueRequired'));
      return;
    }
    setSaving(true);
    try {
      await api('/secrets', { method: 'POST', body: JSON.stringify({ name, type, value }) });
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
    const value = buildValue(true);
    const body: { name: string; value?: string | Record<string, unknown> } = { name };
    if (value) body.value = value;
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

  const canSubmitCreate = Boolean(name.trim() && buildValue(false));
  const canSubmitEdit = Boolean(name.trim());

  return (
    <div className="sd-page sd-page-compact">
      <PageHeader
        title={t('secrets.title')}
        subtitle={t('secrets.neverReexposed')}
        actions={<Button onClick={openCreate}>{t('secrets.create')}</Button>}
      />
      {listError ? <Alert>{listError}</Alert> : null}
      {rows.length === 0 ? <EmptyState>{t('secrets.empty')}</EmptyState> : (
        <div className="sd-entity-list">
          {rows.map((r) => (
            <Panel key={r.id} className="sd-entity-card">
              <div className="sd-entity-item">
                <div className="sd-entity-main">
                  <div className="sd-entity-top">
                    <strong className="sd-entity-name">{r.name}</strong>
                  </div>
                  <div className="sd-entity-meta">
                    {tt(t, 'secretTypes', r.type)}
                  </div>
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
            </Panel>
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
                {saving ? t('common.loading') : t('common.create')}
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
          <Field label={t('secrets.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label={t('secrets.type')}>
            <Select
              value={type}
              disabled={mode === 'edit'}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="registry_credentials">{t('secretTypes.registry_credentials')}</option>
              <option value="generic_token">{t('secretTypes.generic_token')}</option>
              <option value="header_secret">{t('secretTypes.header_secret')}</option>
            </Select>
          </Field>
          {mode === 'edit' ? (
            <div style={{ fontSize: 12, color: 'var(--sd-muted)' }}>{t('secrets.valueKeepHint')}</div>
          ) : null}
          {type === 'registry_credentials' ? (
            <>
              <Field label={t('secrets.username')}>
                <Input
                  value={username}
                  placeholder={mode === 'edit' ? t('secrets.leaveBlank') : undefined}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <Field label={t('secrets.passwordToken')}>
                <Input
                  type="password"
                  value={password}
                  placeholder={mode === 'edit' ? t('secrets.leaveBlank') : undefined}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
              <Field label={t('secrets.serverOptional')}>
                <Input
                  value={serveraddress}
                  placeholder={mode === 'edit' ? t('secrets.leaveBlank') : undefined}
                  onChange={(e) => setServeraddress(e.target.value)}
                />
              </Field>
            </>
          ) : (
            <Field label={t('secrets.value')}>
              <Input
                type="password"
                value={password}
                placeholder={mode === 'edit' ? t('secrets.leaveBlank') : undefined}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          )}
        </div>
      </Modal>
    </div>
  );
}
