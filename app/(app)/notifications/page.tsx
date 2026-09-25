'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { io } from 'socket.io-client';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import type { NotificationItem } from '@/components/NotificationBell';
import { PageHeader, Panel, EmptyState } from '@/components/ui';
import { IconButton, IconCheck } from '@/components/IconActions';

type ListResponse = { items: NotificationItem[]; unreadCount: number };

function levelColor(level: string): string {
  if (level === 'error') return 'var(--sd-danger)';
  if (level === 'warn') return 'var(--sd-warn)';
  return 'var(--sd-accent)';
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
    <div className="sd-page">
      <PageHeader
        title={t('notifications.title')}
        subtitle={`${t('notifications.subtitle')}${unread > 0 ? ` · ${t('notifications.unreadCount', { count: String(unread) })}` : ''}`}
        actions={unread > 0 ? (
          <IconButton label={t('notifications.markAllRead')} onClick={() => { void markAll(); }}>
            <IconCheck />
          </IconButton>
        ) : undefined}
      />

      {items.length === 0 ? <EmptyState>{t('notifications.empty')}</EmptyState> : null}

      {items.map((n) => (
        <Panel
          key={n.id}
          className=""
          // highlight unread via inline
        >
          <div
            style={{
              margin: -16,
              padding: 14,
              borderRadius: 12,
              background: n.readAt ? 'transparent' : 'color-mix(in srgb, var(--sd-accent) 8%, transparent)',
            }}
          >
            <div style={{ display: 'flex', gap: 10 }}>
              <span style={{
                width: 10,
                height: 10,
                borderRadius: 4,
                background: levelColor(n.level),
                marginTop: 5,
                flexShrink: 0,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {n.message}
                </div>
                <div style={{ color: 'var(--sd-muted)', fontSize: 12, marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <span>{formatDate(n.ts)}</span>
                  <span style={{ textTransform: 'uppercase', color: levelColor(n.level), fontWeight: 600 }}>
                    {tt(t, 'notifyLevel', n.level)}
                  </span>
                  {n.flowName ? <span>{n.flowName}</span> : null}
                  {n.containerName ? <span>{n.containerName}</span> : null}
                  {n.image ? <span>{n.image}</span> : null}
                  {n.flowRunId ? <Link href={`/runs/${n.flowRunId}`}>{t('notifications.openRun')}</Link> : null}
                  {!n.readAt ? (
                    <button
                      type="button"
                      onClick={() => { void markRead(n.id); }}
                      style={{ background: 'none', border: 'none', color: 'var(--sd-accent)', cursor: 'pointer', padding: 0, fontSize: 12 }}
                    >
                      {t('notifications.markRead')}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}
