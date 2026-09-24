'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { PageHeader, Button, Input, Textarea, Field, Panel, DataRow, Badge, EmptyState } from '@/components/ui';

export default function TemplatesPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<Array<{ id: string; key: string; name: string; body: string; builtin: boolean }>>([]);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [body, setBody] = useState('{"text":"Hello {{containerName}}"}');

  async function load() { setRows(await api('/templates')); }
  useEffect(() => { void load(); }, []);

  return (
    <div className="sd-page">
      <PageHeader title={t('templates.title')} />
      <Panel>
        <div className="sd-stack" style={{ maxWidth: 560 }}>
          <Field label={t('templates.key')}><Input value={key} onChange={(e) => setKey(e.target.value)} /></Field>
          <Field label={t('templates.name')}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Body"><Textarea value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          <Button
            style={{ width: 'fit-content' }}
            onClick={async () => {
              await api('/templates', { method: 'POST', body: JSON.stringify({ key, name, body }) });
              await load();
            }}
          >
            {t('templates.create')}
          </Button>
        </div>
      </Panel>
      {rows.length === 0 ? <EmptyState>—</EmptyState> : null}
      <Panel>
        {rows.map((r) => (
          <DataRow
            key={r.id}
            title={(
              <>
                {r.name} <code style={{ fontSize: 12, color: 'var(--sd-muted)' }}>{r.key}</code>
                {r.builtin ? <> {' '}<Badge>{t('templates.builtin')}</Badge></> : null}
              </>
            )}
            meta={<pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', fontFamily: 'IBM Plex Mono, monospace' }}>{r.body}</pre>}
            actions={!r.builtin ? (
              <Button variant="danger" onClick={async () => { await api(`/templates/${r.id}`, { method: 'DELETE' }); await load(); }}>
                {t('common.delete')}
              </Button>
            ) : undefined}
          />
        ))}
      </Panel>
    </div>
  );
}
