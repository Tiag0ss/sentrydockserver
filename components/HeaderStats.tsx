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
  awaitingApproval?: number;
};

function StatChip({
  label,
  value,
  href,
  tone = 'default',
}: {
  label: string;
  value: number;
  href?: string;
  tone?: 'default' | 'warn';
}) {
  const className = `sd-header-stat${tone === 'warn' && value > 0 ? ' sd-header-stat-warn' : ''}`;
  const inner = (
    <>
      <span className="sd-header-stat-label">{label}</span>
      <span className="sd-header-stat-value">{value}</span>
    </>
  );
  if (href) {
    return <Link href={href} className={className}>{inner}</Link>;
  }
  return <div className={className}>{inner}</div>;
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
      <div className="sd-header-stats">
        <span className="sd-header-stat-label">{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <div className="sd-header-stats">
      <StatChip label={t('dashboard.agentsOnline')} value={summary.agentsOnline} href="/agents" />
      <StatChip label={t('dashboard.activeRuns')} value={summary.activeRuns} href="/runs" />
      <StatChip label={t('dashboard.pendingUpdates')} value={summary.pendingUpdates} />
      <StatChip
        label={t('dashboard.awaitingApprovalShort')}
        value={summary.awaitingApproval ?? 0}
        href="/runs"
        tone="warn"
      />
    </div>
  );
}
