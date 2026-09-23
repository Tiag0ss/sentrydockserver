'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { io } from 'socket.io-client';
import { DashboardPanels, type DashboardData } from './_components/DashboardPanels';
import { useI18n } from '@/lib/i18n/I18nProvider';

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

  if (error) return <p style={{ color: 'var(--danger)' }}>{error}</p>;
  if (!data) return <p>{t('dashboard.loading')}</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header>
        <h1 style={{ margin: 0 }}>{t('dashboard.title')}</h1>
        <p style={{ color: 'var(--muted)', margin: '6px 0 0' }}>{t('dashboard.subtitle')}</p>
      </header>
      <DashboardPanels data={data} onReload={() => { void load(); }} />
    </div>
  );
}
