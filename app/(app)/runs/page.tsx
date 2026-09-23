'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';

type Run = { id: string; flowId: string; status: string; currentNodeId: string | null; startedAt: string; triggerSource: string };

export default function RunsPage() {
  const { t } = useI18n();
  const [active, setActive] = useState<Run[]>([]);
  const [history, setHistory] = useState<Run[]>([]);

  useEffect(() => {
    void (async () => {
      setActive(await api('/runs?status=active'));
      setHistory(await api('/runs?status=history'));
    })();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h1 style={{ margin: 0 }}>{t('runs.title')}</h1>
      <section>
        <h2>{t('runs.active')}</h2>
        {active.map((r) => (
          <div key={r.id} style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
            <Link href={`/runs/${r.id}`}>{r.id}</Link> — {r.status} — {t('runs.step')} {r.currentNodeId || '—'}
          </div>
        ))}
      </section>
      <section>
        <h2>{t('runs.history')}</h2>
        {history.map((r) => (
          <div key={r.id} style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
            <Link href={`/runs/${r.id}`}>{r.id}</Link> — {r.status} — {r.triggerSource}
          </div>
        ))}
      </section>
    </div>
  );
}
