'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, clearToken } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { LanguageSwitcher } from '@/lib/i18n/LanguageSwitcher';
import { ThemeControls } from '@/components/ui';

type Me = { id: string; username: string; role: string };

export function UserMenu() {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api<{ user: Me }>('/auth/me')
      .then((r) => setMe(r.user))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = (me?.username || 'U').trim().charAt(0).toUpperCase();

  function logout() {
    clearToken();
    setOpen(false);
    router.push('/login');
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="sd-user-trigger"
        aria-label={t('common.userMenu')}
        aria-expanded={open}
        title={me?.username || t('common.userMenu')}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sd-user-avatar" aria-hidden>{initial}</span>
        <span className="sd-user-name">{me?.username || '…'}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s ease', flexShrink: 0 }}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div className="sd-user-dropdown" role="menu">
          <div className="sd-user-dropdown-head">
            <span className="sd-user-avatar" aria-hidden>{initial}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {me?.username || '…'}
              </div>
              {me?.role ? (
                <div style={{ fontSize: 11, color: 'var(--sd-muted)' }}>{me.role}</div>
              ) : null}
            </div>
          </div>

          <div className="sd-user-dropdown-links">
            <Link href="/users" className="sd-user-dropdown-link" onClick={() => setOpen(false)}>
              {t('nav.users')}
            </Link>
            <Link href="/settings" className="sd-user-dropdown-link" onClick={() => setOpen(false)}>
              {t('nav.settings')}
            </Link>
            <Link href="/change-password" className="sd-user-dropdown-link" onClick={() => setOpen(false)}>
              {t('users.changeMyPassword')}
            </Link>
          </div>

          <hr className="sd-user-dropdown-sep" />

          <div className="sd-user-dropdown-section">
            <ThemeControls />
          </div>

          <div className="sd-user-dropdown-section">
            <LanguageSwitcher />
          </div>

          <hr className="sd-user-dropdown-sep" />

          <button type="button" className="sd-user-dropdown-logout" onClick={logout}>
            <span className="sd-user-avatar sd-user-avatar-sm" aria-hidden>{initial}</span>
            {t('common.logout')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
