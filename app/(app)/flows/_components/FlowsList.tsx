'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { PageHeader, Button, Alert, EmptyState, Panel, DataRow } from '@/components/ui';

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
    <div className="sd-page">
      <PageHeader
        title={t('flows.title')}
        subtitle={t('flows.subtitle')}
        actions={<Button onClick={onCreate}>{t('flows.new')}</Button>}
      />

      {loading ? <p style={{ color: 'var(--sd-muted)' }}>{t('flows.loading')}</p> : null}
      {error ? <Alert>{error}</Alert> : null}

      {!loading && !error && flows.length === 0 ? (
        <EmptyState>{t('flows.empty')}</EmptyState>
      ) : null}

      {flows.map((f) => {
        const nodeCount = f.graph?.nodes?.length ?? 0;
        const edgeCount = f.graph?.edges?.length ?? 0;
        return (
          <Panel key={f.id}>
            <DataRow
              title={f.name}
              meta={(
                <>
                  {f.description || t('flows.noDescription')} · {nodeCount} {t('flows.nodes')} · {edgeCount} {t('flows.edges')}
                  <br />
                  {t('flows.updated')} {formatDate(f.updatedAt)}
                </>
              )}
              actions={(
                <>
                  <Button onClick={() => onEdit(f)}>{t('flows.edit')}</Button>
                  <Button variant="danger" onClick={() => { void remove(f.id, f.name); }}>{t('flows.delete')}</Button>
                </>
              )}
            />
          </Panel>
        );
      })}
    </div>
  );
}
