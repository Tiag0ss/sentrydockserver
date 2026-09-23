'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';

export default function WebhooksPage() {
  const { t } = useI18n();
  const [hooks, setHooks] = useState<Array<{ id: string; name: string; flowId: string }>>([]);
  const [flows, setFlows] = useState<Array<{ id: string; name: string }>>([]);
  const [name, setName] = useState('');
  const [flowId, setFlowId] = useState('');
  const [created, setCreated] = useState<{ url: string; token: string } | null>(null);

  useEffect(() => {
    void (async () => {
      setHooks(await api('/webhook-triggers'));
      setFlows(await api('/flows'));
    })();
  }, []);

  async function create() {
    const res = await api<{ id: string; url: string; token: string }>('/webhook-triggers', {
      method: 'POST',
      body: JSON.stringify({ name, flowId }),
    });
    setCreated(res);
    setHooks(await api('/webhook-triggers'));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ margin: 0 }}>{t('webhooks.title')}</h1>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input placeholder={t('webhooks.name')} value={name} onChange={(e) => setName(e.target.value)} style={input} />
        <select value={flowId} onChange={(e) => setFlowId(e.target.value)} style={input}>
          <option value="">{t('webhooks.flow')}</option>
          {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <button type="button" onClick={() => void create()} style={btn}>{t('webhooks.create')}</button>
      </div>
      {created && (
        <div style={{ border: '1px solid var(--warn)', padding: 12, borderRadius: 8 }}>
          <div>POST {created.url}</div>
          <div>Header X-SentryDock-Token: <code>{created.token}</code></div>
        </div>
      )}
      {hooks.map((h) => (
        <div key={h.id} style={{ borderBottom: '1px solid var(--border)', padding: 8 }}>
          {h.name} → flow {h.flowId.slice(0, 8)}… · /api/hooks/{h.id}
        </div>
      ))}
    </div>
  );
}

const input: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)' };
const btn: React.CSSProperties = { background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 600, cursor: 'pointer' };
