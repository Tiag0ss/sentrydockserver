'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { LanguageSwitcher } from '@/lib/i18n/LanguageSwitcher';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api<{ token: string; user: { mustChangePassword: boolean } }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setToken(res.token);
      router.replace(res.user.mustChangePassword ? '/change-password' : '/');
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
        maxWidth: 380,
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 28,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h1 style={{ margin: 0, fontFamily: 'IBM Plex Mono, monospace' }}>
            Sentry<span style={{ color: 'var(--accent)' }}>Dock</span>
          </h1>
          <LanguageSwitcher compact />
        </div>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>{t('login.subtitle')}</p>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12 }}>{t('login.defaultHint')}</p>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          {t('login.username')}
          <input value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle} autoComplete="username" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          {t('login.password')}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} autoComplete="current-password" />
        </label>
        {error && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
        <button type="submit" disabled={loading} style={btnStyle}>
          {loading ? t('login.submitting') : t('login.submit')}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
  color: 'var(--text)',
};

const btnStyle: React.CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--bg)',
  border: 'none',
  borderRadius: 8,
  padding: '12px 14px',
  fontWeight: 600,
  cursor: 'pointer',
};
