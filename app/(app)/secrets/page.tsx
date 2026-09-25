'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import {
  PageHeader, Button, Input, Select, Field, Panel, EmptyState, Modal, Alert,
} from '@/components/ui';
import { IconButton, IconTrash } from '@/components/IconActions';

export default function SecretsPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('registry_credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serveraddress, setServeraddress] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() { setRows(await api('/secrets')); }
  useEffect(() => { void load(); }, []);

  function openCreate() {
    setName('');
    setType('registry_credentials');
    setUsername('');
    setPassword('');
    setServeraddress('');
    setFormError('');
    setOpen(true);
  }

  async function create() {
    setFormError('');
    setSaving(true);
    try {
      const value = type === 'registry_credentials'
        ? { username, password, serveraddress }
        : password;
      await api('/secrets', { method: 'POST', body: JSON.stringify({ name, type, value }) });
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
        title={t('secrets.title')}
        subtitle={t('secrets.neverReexposed')}
        actions={<Button onClick={openCreate}>{t('secrets.create')}</Button>}
      />
      {rows.length === 0 ? <EmptyState>—</EmptyState> : (
        <div className="sd-entity-list">
          {rows.map((r) => (
            <Panel key={r.id} className="sd-entity-card">
              <div className="sd-entity-item">
                <div className="sd-entity-main">
                  <div className="sd-entity-top">
                    <strong className="sd-entity-name">{r.name}</strong>
                  </div>
                  <div className="sd-entity-meta">
                    {tt(t, 'secretTypes', r.type)} · {r.id.slice(0, 8)}…
                  </div>
                </div>
                <div className="sd-entity-actions">
                  <IconButton
                    label={t('secrets.delete')}
                    tone="danger"
                    onClick={async () => { await api(`/secrets/${r.id}`, { method: 'DELETE' }); await load(); }}
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
        open={open}
        title={t('secrets.create')}
        onClose={() => setOpen(false)}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button disabled={!name.trim() || saving} onClick={() => { void create(); }}>
              {saving ? t('common.loading') : t('common.create')}
            </Button>
          </>
        )}
      >
        {formError ? <Alert>{formError}</Alert> : null}
        <div className="sd-stack">
          <Field label={t('secrets.name')}><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="registry_credentials">{t('secretTypes.registry_credentials')}</option>
              <option value="generic_token">{t('secretTypes.generic_token')}</option>
              <option value="header_secret">{t('secretTypes.header_secret')}</option>
            </Select>
          </Field>
          {type === 'registry_credentials' ? (
            <>
              <Field label={t('secrets.username')}><Input value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
              <Field label={t('secrets.passwordToken')}><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
              <Field label={t('secrets.serverOptional')}><Input value={serveraddress} onChange={(e) => setServeraddress(e.target.value)} /></Field>
            </>
          ) : (
            <Field label={t('secrets.value')}><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          )}
        </div>
      </Modal>
    </div>
  );
}
