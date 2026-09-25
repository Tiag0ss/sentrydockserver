'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { io } from 'socket.io-client';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import type { NotificationItem } from '@/components/NotificationBell';
import { PageHeader, Panel, EmptyState, Button } from '@/components/ui';
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
    <div className="sd-page sd-page-compact">
      <PageHeader
        title={t('notifications.title')}
        subtitle={`${t('notifications.subtitle')}${unread > 0 ? ` · ${t('notifications.unreadCount', { count: String(unread) })}` : ''}`}
        actions={unread > 0 ? (
          <Button variant="ghost" onClick={() => { void markAll(); }}>
            {t('notifications.markAllRead')}
          </Button>
        ) : undefined}
      />

      {items.length === 0 ? <EmptyState>{t('notifications.empty')}</EmptyState> : (
        <div className="sd-entity-list">
          {items.map((n) => (
            <Panel
              key={n.id}
              className={`sd-entity-card${n.readAt ? '' : ' sd-entity-card-unread'}`}
            >
              <div className="sd-entity-item">
                <span
                  className="sd-entity-dot"
                  style={{ background: levelColor(n.level) }}
                  aria-hidden
                />
                <div className="sd-entity-main">
                  <div className="sd-entity-top">
                    <strong className="sd-entity-name" style={{ fontWeight: n.readAt ? 500 : 600 }}>
                      {n.message}
                    </strong>
                  </div>
                  <div className="sd-entity-meta sd-entity-meta-wrap">
                    {formatDate(n.ts)}
                    {' · '}
                    <span style={{ color: levelColor(n.level), fontWeight: 600, textTransform: 'uppercase' }}>
                      {tt(t, 'notifyLevel', n.level)}
                    </span>
                    {n.flowName ? <> · {n.flowName}</> : null}
                    {n.containerName ? <> · {n.containerName}</> : null}
                    {n.image ? <> · {n.image}</> : null}
                    {n.flowRunId ? (
                      <>
                        {' · '}
                        <Link href={`/runs/${n.flowRunId}`} className="sd-entity-link">
                          {t('notifications.openRun')}
                        </Link>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="sd-entity-actions">
                  {!n.readAt ? (
                    <IconButton label={t('notifications.markRead')} onClick={() => { void markRead(n.id); }}>
                      <IconCheck />
                    </IconButton>
                  ) : null}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
