'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';

type Agent = { id: string; name: string; status: string; online: boolean; transport: string; protocolVersion: number | null; token?: string };

export default function AgentsPage() {
  const { t } = useI18n();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState('ws');
  const [createdToken, setCreatedToken] = useState('');

  async function load() {
    setAgents(await api('/agents'));
  }

  useEffect(() => { void load(); }, []);

  async function create() {
    const res = await api<Agent>('/agents', { method: 'POST', body: JSON.stringify({ name, transport }) });
    setCreatedToken(res.token || '');
    setName('');
    await load();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ margin: 0 }}>{t('agents.title')}</h1>
      <div style={{ display: 'flex', gap: 8 }}>
        <input placeholder={t('agents.name')} value={name} onChange={(e) => setName(e.target.value)} style={input} />
        <select value={transport} onChange={(e) => setTransport(e.target.value)} style={input}>
          <option value="ws">WebSocket</option>
          <option value="grpc">gRPC</option>
        </select>
        <button type="button" onClick={() => void create()} style={btn}>{t('agents.create')}</button>
      </div>
      {createdToken && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--warn)', padding: 12, borderRadius: 8 }}>
          {t('agents.tokenOnce')}: <code>{createdToken}</code>
        </div>
      )}
      {agents.map((a) => (
        <div key={a.id} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, justifyContent: 'space-between', display: 'flex' }}>
          <div>
            <strong>{a.name}</strong> · {a.transport} · proto {a.protocolVersion ?? '—'}
            <div style={{ color: a.online ? 'var(--ok)' : 'var(--muted)' }}>{a.online ? t('agents.online') : a.status}</div>
          </div>
          <button type="button" onClick={async () => { await api(`/agents/${a.id}`, { method: 'DELETE' }); await load(); }}
            style={{ background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 6, cursor: 'pointer' }}>
            {t('agents.remove')}
          </button>
        </div>
      ))}
    </div>
  );
}

const input: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)' };
const btn: React.CSSProperties = { background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 600, cursor: 'pointer' };
