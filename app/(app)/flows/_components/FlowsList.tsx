'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { btnStyle, btnSecondaryStyle } from './flowConstants';
import { useI18n } from '@/lib/i18n/I18nProvider';

export type FlowSummary = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  graph: { nodes: unknown[]; edges: unknown[] };
};

type Props = {
  onCreate: () => void;
  onEdit: (flow: FlowSummary) => void;
};

export function FlowsList({ onCreate, onEdit }: Props) {
  const { t, formatDate } = useI18n();
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setFlows(await api<FlowSummary[]>('/flows'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('flows.loadError'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function remove(id: string, name: string) {
    if (!window.confirm(t('flows.deleteConfirm', { name }))) return;
    await api(`/flows/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0 }}>{t('flows.title')}</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 14 }}>
            {t('flows.subtitle')}
          </p>
        </div>
        <button type="button" onClick={onCreate} style={btnStyle}>{t('flows.new')}</button>
      </header>

      {loading && <p style={{ color: 'var(--muted)' }}>{t('flows.loading')}</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {!loading && !error && flows.length === 0 && (
        <div style={{
          border: '1px dashed var(--border)',
          borderRadius: 12,
          padding: 32,
          textAlign: 'center',
          color: 'var(--muted)',
        }}>
          {t('flows.empty')}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {flows.map((f) => {
          const nodeCount = f.graph?.nodes?.length ?? 0;
          const edgeCount = f.graph?.edges?.length ?? 0;
          return (
            <div
              key={f.id}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                flexWrap: 'wrap',
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '14px 16px',
              }}
            >
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 600 }}>{f.name}</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                  {f.description || t('flows.noDescription')} · {nodeCount} {t('flows.nodes')} · {edgeCount} {t('flows.edges')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {t('flows.updated')} {formatDate(f.updatedAt)}
                </div>
              </div>
              <button type="button" onClick={() => onEdit(f)} style={btnStyle}>{t('flows.edit')}</button>
              <button
                type="button"
                onClick={() => void remove(f.id, f.name)}
                style={{ ...btnSecondaryStyle, color: 'var(--danger)', borderColor: 'var(--danger)' }}
              >
                {t('flows.delete')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
