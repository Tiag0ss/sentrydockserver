'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { io } from 'socket.io-client';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import type { NotificationItem } from '@/components/NotificationBell';

type ListResponse = { items: NotificationItem[]; unreadCount: number };

function levelColor(level: string): string {
  if (level === 'error') return 'var(--danger)';
  if (level === 'warn') return 'var(--warn)';
  return 'var(--accent)';
}

export default function NotificationsPage() {
  const { t, formatDate } = useI18n();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    const data = await api<ListResponse>('/notifications?limit=100');
    setItems(data.items);
    setUnread(data.unreadCount);
  }, []);

  useEffect(() => {
    void load();
    const socket = io('/ui', { path: '/socket.io' });
    socket.on('notification:new', () => { void load(); });
    return () => { socket.close(); };
  }, [load]);

  async function markRead(id: string) {
    await api(`/notifications/${id}/read`, { method: 'POST', body: '{}' });
    await load();
  }

  async function markAll() {
    await api('/notifications/read-all', { method: 'POST', body: '{}' });
    await load();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>{t('notifications.title')}</h1>
          <p style={{ color: 'var(--muted)', margin: '6px 0 0', fontSize: 14 }}>
            {t('notifications.subtitle')}
            {unread > 0 ? ` · ${t('notifications.unreadCount', { count: String(unread) })}` : ''}
          </p>
        </div>
        {unread > 0 && (
          <button
            type="button"
            onClick={() => { void markAll(); }}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              borderRadius: 8,
              padding: '8px 12px',
              cursor: 'pointer',
            }}
          >
            {t('notifications.markAllRead')}
          </button>
        )}
      </header>

      {items.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>{t('notifications.empty')}</p>
      )}

      {items.map((n) => (
        <article
          key={n.id}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 14,
            background: n.readAt ? 'var(--panel)' : 'rgba(61, 214, 198, 0.08)',
          }}
        >
          <div style={{ display: 'flex', gap: 10 }}>
            <span style={{
              width: 10,
              height: 10,
              borderRadius: 99,
              background: levelColor(n.level),
              marginTop: 5,
              flexShrink: 0,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {n.message}
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <span>{formatDate(n.ts)}</span>
                <span style={{ textTransform: 'uppercase', color: levelColor(n.level), fontWeight: 600 }}>{tt(t, 'notifyLevel', n.level)}</span>
                {n.flowName && <span>{n.flowName}</span>}
                {n.containerName && <span>{n.containerName}</span>}
                {n.image && <span>{n.image}</span>}
                {n.flowRunId && (
                  <Link href={`/runs/${n.flowRunId}`}>{t('notifications.openRun')}</Link>
                )}
                {!n.readAt && (
                  <button
                    type="button"
                    onClick={() => { void markRead(n.id); }}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontSize: 12 }}
                  >
                    {t('notifications.markRead')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
