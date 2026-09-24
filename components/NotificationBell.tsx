'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { io } from 'socket.io-client';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';

export type NotificationItem = {
  id: string;
  ts: string | Date;
  message: string;
  level: string;
  flowRunId: string | null;
  flowId: string | null;
  flowName: string | null;
  agentId: string | null;
  containerName: string | null;
  image: string | null;
  readAt: string | Date | null;
};

type ListResponse = { items: NotificationItem[]; unreadCount: number };

function levelColor(level: string): string {
  if (level === 'error') return 'var(--danger)';
  if (level === 'warn') return 'var(--warn)';
  return 'var(--accent)';
}

function BellIcon({ active }: { active?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? 'var(--accent)' : 'currentColor'}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export function NotificationBell() {
  const { t, formatDate } = useI18n();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<ListResponse>('/notifications?limit=20');
      setItems(data.items);
      setUnread(data.unreadCount);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
    const socket = io('/ui', { path: '/socket.io' });
    socket.on('notification:new', (n: NotificationItem) => {
      setItems((prev) => [n, ...prev].slice(0, 20));
      setUnread((c) => c + 1);
    });
    const timer = setInterval(() => { void load(); }, 30_000);
    return () => { socket.close(); clearInterval(timer); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function markRead(id: string) {
    await api(`/notifications/${id}/read`, { method: 'POST', body: '{}' });
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnread((c) => Math.max(0, c - 1));
  }

  async function markAll() {
    await api('/notifications/read-all', { method: 'POST', body: '{}' });
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    setUnread(0);
  }

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); if (!open) void load(); }}
        aria-label={t('notifications.title')}
        title={t('notifications.title')}
        style={{
          position: 'relative',
          width: 40,
          height: 40,
          background: open ? 'color-mix(in srgb, var(--sd-accent) 12%, transparent)' : 'transparent',
          border: `1px solid ${open ? 'var(--sd-accent)' : 'var(--sd-border)'}`,
          color: 'var(--sd-text)',
          borderRadius: 10,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        <BellIcon active={open || unread > 0} />
        {unread > 0 && (
          <span style={{
            position: 'absolute',
            top: 4,
            right: 4,
            background: 'var(--danger)',
            color: '#fff',
            borderRadius: 999,
            minWidth: 16,
            height: 16,
            fontSize: 10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px',
            fontWeight: 700,
            lineHeight: 1,
            border: '2px solid var(--bg)',
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          right: 0,
          top: 'calc(100% + 10px)',
          width: 380,
          maxWidth: 'min(380px, calc(100vw - 48px))',
          maxHeight: 440,
          overflow: 'auto',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: 'var(--sd-shadow), 0 16px 48px rgba(0,0,0,0.18)',
          zIndex: 80,
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 14px',
            borderBottom: '1px solid var(--border)',
            position: 'sticky',
            top: 0,
            background: 'var(--panel)',
            zIndex: 1,
          }}>
            <strong style={{ fontSize: 14 }}>{t('notifications.title')}</strong>
            <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => { void markAll(); }}
                  style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0 }}
                >
                  {t('notifications.markAllRead')}
                </button>
              )}
              <Link href="/notifications" onClick={() => setOpen(false)} style={{ color: 'var(--muted)' }}>
                {t('notifications.viewAll')}
              </Link>
            </div>
          </div>

          {items.length === 0 && (
            <p style={{ color: 'var(--muted)', padding: 16, margin: 0, fontSize: 13 }}>
              {t('notifications.empty')}
            </p>
          )}

          {items.map((n) => (
            <div
              key={n.id}
              style={{
                padding: '12px 14px',
                borderBottom: '1px solid var(--border)',
                background: n.readAt ? 'transparent' : 'color-mix(in srgb, var(--sd-accent) 8%, transparent)',
                cursor: n.readAt ? 'default' : 'pointer',
              }}
              onClick={() => { if (!n.readAt) void markRead(n.id); }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: 99,
                  background: levelColor(n.level),
                  flexShrink: 0,
                  marginTop: 4,
                }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {n.message}
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 4 }}>
                    {formatDate(n.ts)}
                    {n.flowName ? ` · ${n.flowName}` : ''}
                    {n.containerName ? ` · ${n.containerName}` : ''}
                    {n.flowRunId && (
                      <>
                        {' · '}
                        <Link href={`/runs/${n.flowRunId}`} onClick={(e) => e.stopPropagation()}>
                          {n.flowRunId.slice(0, 8)}…
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
