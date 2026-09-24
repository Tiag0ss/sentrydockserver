'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';

export default function TemplatesPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Array<{ id: string; key: string; name: string; body: string; builtin: boolean }>>([]);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [body, setBody] = useState('{"text":"Hello {{containerName}}"}');

  async function load() { setRows(await api('/templates')); }
  useEffect(() => { void load(); }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ margin: 0 }}>{t('templates.title')}</h1>
      <div style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
        <input placeholder={t('templates.key')} value={key} onChange={(e) => setKey(e.target.value)} style={input} />
        <input placeholder={t('templates.name')} value={name} onChange={(e) => setName(e.target.value)} style={input} />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ ...input, minHeight: 100 }} />
        <button type="button" style={btn} onClick={async () => {
          await api('/templates', { method: 'POST', body: JSON.stringify({ key, name, body }) });
          await load();
        }}>{t('templates.create')}</button>
      </div>
      {rows.map((r) => (
        <div key={r.id} style={{ borderBottom: '1px solid var(--border)', padding: 8, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <strong>{r.name}</strong> <code>{r.key}</code> {r.builtin && t('templates.builtin')}
            <pre style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>{r.body}</pre>
          </div>
          {!r.builtin && (
            <button
              type="button"
              onClick={async () => {
                await api(`/templates/${r.id}`, { method: 'DELETE' });
                await load();
              }}
              style={{ background: 'transparent', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 6, cursor: 'pointer' }}
            >
              {t('common.delete')}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

const input: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)' };
const btn: React.CSSProperties = { background: 'var(--accent)', border: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 600, cursor: 'pointer' };
