'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { io } from 'socket.io-client';
import { DashboardPanels, type DashboardData } from './_components/DashboardPanels';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { PageHeader, Alert } from '@/components/ui';
import { WhatsNewModal } from '@/components/WhatsNewModal';
import {
  fetchWhatsNew,
  markWhatsNewSeen,
  type WhatsNewEntry,
} from '@/lib/whatsNew';

export default function DashboardPage() {
  const { t } = useI18n();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [whatsNewEntries, setWhatsNewEntries] = useState<WhatsNewEntry[]>([]);
  const [whatsNewCurrentVersion, setWhatsNewCurrentVersion] = useState('');
  const [whatsNewAcknowledging, setWhatsNewAcknowledging] = useState(false);
  const whatsNewCheckedRef = useRef(false);

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

  useEffect(() => {
    if (whatsNewCheckedRef.current) return;
    whatsNewCheckedRef.current = true;

    let cancelled = false;
    const loadWhatsNew = async () => {
      try {
        const payload = await fetchWhatsNew();
        if (cancelled) return;
        setWhatsNewCurrentVersion(payload.currentVersion);
        setWhatsNewEntries(payload.entries);
        if (payload.entries.length === 0) return;
        try {
          const dismissed = sessionStorage.getItem(
            `sentrydock.whatsNew.dismissed.${payload.currentVersion}`,
          );
          if (dismissed === '1') return;
        } catch {
          /* sessionStorage may be unavailable */
        }
        setWhatsNewOpen(true);
      } catch {
        /* Non-blocking: dashboard still works if What’s New fails */
      }
    };

    void loadWhatsNew();
    return () => { cancelled = true; };
  }, []);

  async function handleWhatsNewAcknowledge() {
    setWhatsNewAcknowledging(true);
    try {
      try {
        sessionStorage.setItem(
          `sentrydock.whatsNew.dismissed.${whatsNewCurrentVersion || 'current'}`,
          '1',
        );
      } catch {
        /* ignore */
      }
      await markWhatsNewSeen();
    } catch {
      /* Still close; user can reopen from the menu */
    } finally {
      setWhatsNewAcknowledging(false);
      setWhatsNewOpen(false);
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p>{t('dashboard.loading')}</p>;

  return (
    <div className="sd-page sd-page-compact">
      <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />
      <DashboardPanels data={data} onReload={() => { void load(); }} />

      <WhatsNewModal
        open={whatsNewOpen}
        mode="delta"
        currentVersion={whatsNewCurrentVersion}
        entries={whatsNewEntries}
        acknowledgeOnClose
        acknowledging={whatsNewAcknowledging}
        onClose={() => { void handleWhatsNewAcknowledge(); }}
      />
    </div>
  );
}
