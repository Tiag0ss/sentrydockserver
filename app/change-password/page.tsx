'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken, getToken, clearToken } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';

export default function ChangePasswordPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forced, setForced] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    void (async () => {
      try {
        const me = await api<{ user: { mustChangePassword: boolean } }>('/auth/me');
        setForced(Boolean(me.user.mustChangePassword));
      } catch {
        clearToken();
        router.replace('/login');
      }
    })();
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) {
      setError(t('users.passwordMismatch'));
      return;
    }
    setLoading(true);
    try {
      const res = await api<{ token: string }>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setToken(res.token);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <form onSubmit={onSubmit} style={{
        width: '100%',
        maxWidth: 420,
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 28,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>{t('users.changePasswordTitle')}</h1>
        {forced && (
          <p style={{ margin: 0, color: 'var(--warn)', fontSize: 14 }}>
            {t('users.mustChangeHint')}
          </p>
        )}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          {t('users.currentPassword')}
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={input} required />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          {t('users.newPassword')}
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={input} required minLength={6} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          {t('users.confirmPassword')}
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} style={input} required minLength={6} />
        </label>
        {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
        <button type="submit" disabled={loading} style={btn}>
          {loading ? t('common.loading') : t('users.savePassword')}
        </button>
        {!forced && (
          <button type="button" onClick={() => router.back()} style={btnGhost}>
            {t('common.back')}
          </button>
        )}
      </form>
    </div>
  );
}

const input: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
  color: 'var(--text)',
};
const btn: React.CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--bg)',
  border: 'none',
  borderRadius: 8,
  padding: '12px 14px',
  fontWeight: 600,
  cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  ...btn,
  background: 'transparent',
  color: 'var(--muted)',
  border: '1px solid var(--border)',
};
