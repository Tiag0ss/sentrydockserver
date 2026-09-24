'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, clearToken, getToken } from '@/lib/api';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { LanguageSwitcher } from '@/lib/i18n/LanguageSwitcher';
import { NotificationBell } from '@/components/NotificationBell';
import { HeaderStats } from '@/components/HeaderStats';

const NAV_KEYS = [
  { href: '/', key: 'nav.dashboard' },
  { href: '/flows', key: 'nav.flows' },
  { href: '/policies', key: 'nav.policies' },
  { href: '/runs', key: 'nav.runs' },
  { href: '/agents', key: 'nav.agents' },
  { href: '/secrets', key: 'nav.secrets' },
  { href: '/webhooks', key: 'nav.webhooks' },
  { href: '/templates', key: 'nav.templates' },
  { href: '/logs', key: 'nav.logs' },
  { href: '/users', key: 'nav.users' },
  { href: '/settings', key: 'nav.settings' },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken() && pathname !== '/login') {
      router.replace('/login');
      return;
    }
    if (!getToken()) {
      setReady(true);
      return;
    }
    void (async () => {
      try {
        const me = await api<{ user: { mustChangePassword: boolean } }>('/auth/me');
        if (me.user.mustChangePassword && pathname !== '/change-password') {
          router.replace('/change-password');
          return;
        }
        setReady(true);
      } catch {
        clearToken();
        router.replace('/login');
      }
    })();
  }, [pathname, router]);

  if (pathname === '/login' || pathname === '/change-password') return <>{children}</>;
  if (!ready) return <div style={{ padding: 40 }}>{t('common.loading')}</div>;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '220px 1fr',
      position: 'fixed',
      inset: 0,
      overflow: 'hidden',
    }}>
      <aside style={{
        borderRight: '1px solid var(--border)',
        background: 'rgba(20,28,46,0.9)',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        height: '100%',
        overflow: 'hidden',
      }}>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, fontSize: 18, marginBottom: 16, letterSpacing: 0.5, flexShrink: 0 }}>
          Sentry<span style={{ color: 'var(--accent)' }}>Dock</span>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {NAV_KEYS.map((n) => {
            const active = pathname === n.href || (n.href !== '/' && pathname.startsWith(n.href));
            return (
              <Link
                key={n.href}
                href={n.href}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  color: active ? 'var(--bg)' : 'var(--text)',
                  background: active ? 'var(--accent)' : 'transparent',
                  fontWeight: active ? 600 : 400,
                  flexShrink: 0,
                }}
              >
                {t(n.key)}
              </Link>
            );
          })}
        </nav>
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0, paddingTop: 12 }}>
          <LanguageSwitcher />
          <button
            type="button"
            onClick={() => { clearToken(); router.push('/login'); }}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--muted)',
              padding: '8px 12px',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            {t('common.logout')}
          </button>
        </div>
      </aside>

      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%', overflow: 'hidden' }}>
        <header style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '10px 28px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(12, 18, 34, 0.65)',
          backdropFilter: 'blur(8px)',
          flexShrink: 0,
          zIndex: 40,
        }}>
          <HeaderStats />
          <div style={{ flexShrink: 0 }}>
            <NotificationBell />
          </div>
        </header>
        <main style={{ padding: 28, overflow: 'auto', flex: 1, minHeight: 0 }}>{children}</main>
      </div>
    </div>
  );
}
