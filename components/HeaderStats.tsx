'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';

type Summary = {
  agentsOnline: number;
  activeRuns: number;
  pendingUpdates: number;
};

function StatChip({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href?: string;
}) {
  const inner = (
    <>
      <span style={{ color: 'var(--muted)', fontSize: 11, lineHeight: 1.2 }}>{label}</span>
      <span style={{
        fontFamily: 'IBM Plex Mono, monospace',
        fontWeight: 700,
        fontSize: 16,
        lineHeight: 1.2,
        color: 'var(--text)',
      }}>
        {value}
      </span>
    </>
  );
  const style: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '4px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'rgba(20, 28, 46, 0.55)',
    textDecoration: 'none',
    color: 'inherit',
    minWidth: 88,
  };
  if (href) {
    return <Link href={href} style={style}>{inner}</Link>;
  }
  return <div style={style}>{inner}</div>;
}

export function HeaderStats() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<Summary | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ summary: Summary }>('/dashboard');
      setSummary(data.summary);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
    const socket = io('/ui', { path: '/socket.io' });
    socket.on('dashboard:ping', () => { void load(); });
    const timer = setInterval(() => { void load(); }, 15_000);
    return () => { socket.close(); clearInterval(timer); };
  }, [load]);

  if (!summary) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 0 }}>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      flex: 1,
      minWidth: 0,
      flexWrap: 'wrap',
    }}>
      <StatChip label={t('dashboard.agentsOnline')} value={summary.agentsOnline} href="/agents" />
      <StatChip label={t('dashboard.activeRuns')} value={summary.activeRuns} href="/runs" />
      <StatChip label={t('dashboard.pendingUpdates')} value={summary.pendingUpdates} />
    </div>
  );
}
