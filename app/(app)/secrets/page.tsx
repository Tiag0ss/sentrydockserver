'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ margin: 0 }}>{t('secrets.title')}</h1>
      <p style={{ color: 'var(--muted)', margin: 0 }}>{t('secrets.neverReexposed')}</p>
      <div style={{ display: 'grid', gap: 8, maxWidth: 420 }}>
        <input placeholder={t('secrets.name')} value={name} onChange={(e) => setName(e.target.value)} style={input} />
        <select value={type} onChange={(e) => setType(e.target.value)} style={input}>
          <option value="registry_credentials">registry_credentials</option>
          <option value="generic_token">generic_token</option>
          <option value="header_secret">header_secret</option>
        </select>
        {type === 'registry_credentials' ? (
          <>
            <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} style={input} />
            <input placeholder="Password/token" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={input} />
            <input placeholder={t('secrets.serverOptional')} value={serveraddress} onChange={(e) => setServeraddress(e.target.value)} style={input} />
          </>
        ) : (
          <input placeholder={t('secrets.value')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={input} />
        )}
        <button type="button" onClick={() => void create()} style={btn}>{t('secrets.create')}</button>
      </div>
      {rows.map((r) => (
        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', padding: 8 }}>
          <span>{r.name} <code style={{ color: 'var(--muted)' }}>{r.type}</code> · id {r.id.slice(0, 8)}</span>
          <button type="button" onClick={async () => { await api(`/secrets/${r.id}`, { method: 'DELETE' }); await load(); }}
            style={{ background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 6, cursor: 'pointer' }}>{t('secrets.delete')}</button>
        </div>
      ))}
    </div>
  );
}

const input: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)' };
const btn: React.CSSProperties = { background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 600, cursor: 'pointer' };
