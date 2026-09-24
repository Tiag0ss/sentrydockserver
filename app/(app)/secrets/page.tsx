'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import { PageHeader, Button, Input, Select, Field, Panel, DataRow, EmptyState } from '@/components/ui';

export default function SecretsPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState('registry_credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serveraddress, setServeraddress] = useState('');

  async function load() { setRows(await api('/secrets')); }
  useEffect(() => { void load(); }, []);

  async function create() {
    const value = type === 'registry_credentials'
      ? { username, password, serveraddress }
      : password;
    await api('/secrets', { method: 'POST', body: JSON.stringify({ name, type, value }) });
    setName(''); setUsername(''); setPassword(''); setServeraddress('');
    await load();
  }

  return (
    <div className="sd-page">
      <PageHeader title={t('secrets.title')} subtitle={t('secrets.neverReexposed')} />
      <Panel>
        <div className="sd-stack" style={{ maxWidth: 440 }}>
          <Field label={t('secrets.name')}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
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
          <Button onClick={() => { void create(); }} style={{ width: 'fit-content' }}>{t('secrets.create')}</Button>
        </div>
      </Panel>
      {rows.length === 0 ? <EmptyState>—</EmptyState> : null}
      <Panel>
        {rows.map((r) => (
          <DataRow
            key={r.id}
            title={r.name}
            meta={`${tt(t, 'secretTypes', r.type)} · ${r.id.slice(0, 8)}…`}
            actions={(
              <Button variant="danger" onClick={async () => { await api(`/secrets/${r.id}`, { method: 'DELETE' }); await load(); }}>
                {t('secrets.delete')}
              </Button>
            )}
          />
        ))}
      </Panel>
    </div>
  );
}
