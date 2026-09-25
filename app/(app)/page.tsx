'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { io } from 'socket.io-client';
import { DashboardPanels, type DashboardData } from './_components/DashboardPanels';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { PageHeader, Alert } from '@/components/ui';

export default function DashboardPage() {
  const { t } = useI18n();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      setData(await api<DashboardData>('/dashboard'));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  useEffect(() => {
    void load();
    const socket = io('/ui', { path: '/socket.io' });
    socket.on('dashboard:ping', () => { void load(); });
    const timer = setInterval(() => { void load(); }, 8000);
    return () => { socket.close(); clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p>{t('dashboard.loading')}</p>;

  return (
    <div className="sd-page sd-page-compact">
      <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />
      <DashboardPanels data={data} onReload={() => { void load(); }} />
    </div>
  );
}
