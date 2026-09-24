'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, clearToken, getToken } from '@/lib/api';
import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { NotificationBell } from '@/components/NotificationBell';
import { HeaderStats } from '@/components/HeaderStats';
import { UserMenu } from '@/components/UserMenu';
import { InstallAppPrompt } from '@/components/InstallAppPrompt';

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
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

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
    <div className="sd-shell" data-nav-open={navOpen}>
      <div
        className="sd-overlay"
        role="presentation"
        onClick={() => setNavOpen(false)}
      />
      <aside className="sd-sidebar">
        <div className="sd-brand">
          Sentry<span>Dock</span>
        </div>
        <nav className="sd-nav">
          {NAV_KEYS.map((n) => {
            const active = pathname === n.href || (n.href !== '/' && pathname.startsWith(n.href));
            return (
              <Link
                key={n.href}
                href={n.href}
                className="sd-nav-link"
                data-active={active}
                onClick={() => setNavOpen(false)}
              >
                {t(n.key)}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="sd-main-col">
        <header className="sd-topbar">
          <button
            type="button"
            className="sd-menu-btn"
            aria-label={navOpen ? t('common.closeMenu') : t('common.menu')}
            onClick={() => setNavOpen((v) => !v)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {navOpen ? (
                <path d="M18 6L6 18M6 6l12 12" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
            <HeaderStats />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main className="sd-content">
          <InstallAppPrompt />
          {children}
        </main>
      </div>
    </div>
  );
}
