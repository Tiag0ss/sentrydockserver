'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';

type Agent = {
  id: string;
  name: string;
  status: string;
  online: boolean;
  transport: string;
  protocolVersion: number | null;
  token?: string;
  labels?: string[];
  meta?: {
    containers?: number;
    danglingImages?: number;
    diskUsedBytes?: number;
    diskTotalBytes?: number;
  } | null;
};

export default function AgentsPage() {
  const { t } = useI18n();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState('ws');
  const [createdToken, setCreatedToken] = useState('');
  const [labelDraft, setLabelDraft] = useState<Record<string, string>>({});

  async function load() {
    const rows = await api<Agent[]>('/agents');
    setAgents(rows);
    const drafts: Record<string, string> = {};
    for (const a of rows) {
      drafts[a.id] = (a.labels || []).join(', ');
    }
    setLabelDraft(drafts);
  }

  useEffect(() => { void load(); }, []);

  async function create() {
    const res = await api<Agent>('/agents', { method: 'POST', body: JSON.stringify({ name, transport }) });
    setCreatedToken(res.token || '');
    setName('');
    await load();
  }

  async function saveLabels(id: string) {
    const labels = (labelDraft[id] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await api(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify({ labels }) });
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
        <div key={a.id} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, justifyContent: 'space-between', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <strong>{a.name}</strong> · {a.transport} · {t('agents.protocol')} {a.protocolVersion ?? '—'}
            <div style={{ color: a.online ? 'var(--ok)' : 'var(--muted)' }}>
              {a.online ? t('agents.online') : (a.status ? tt(t, 'status', a.status) : t('agents.offline'))}
            </div>
            {a.meta && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                {[
                  a.meta.containers != null ? `${a.meta.containers} containers` : null,
                  a.meta.danglingImages != null ? `${a.meta.danglingImages} dangling` : null,
                  a.meta.diskUsedBytes != null
                    ? `disk ${(a.meta.diskUsedBytes / (1024 ** 3)).toFixed(1)} GiB`
                    : null,
                ].filter(Boolean).join(' · ')}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <input
                style={{ ...input, minWidth: 200, flex: 1 }}
                placeholder={t('agents.labelsPlaceholder')}
                value={labelDraft[a.id] || ''}
                onChange={(e) => setLabelDraft((s) => ({ ...s, [a.id]: e.target.value }))}
              />
              <button type="button" style={btn} onClick={() => { void saveLabels(a.id); }}>
                {t('agents.saveLabels')}
              </button>
            </div>
          </div>
          <button type="button" onClick={async () => { await api(`/agents/${a.id}`, { method: 'DELETE' }); await load(); }}
            style={{ background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 6, cursor: 'pointer', height: 36 }}>
            {t('agents.remove')}
          </button>
        </div>
      ))}
    </div>
  );
}

const input: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)' };
const btn: React.CSSProperties = { background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 600, cursor: 'pointer' };
