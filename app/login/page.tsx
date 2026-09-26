'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { LanguageSwitcher } from '@/lib/i18n/LanguageSwitcher';
import { Field, Input, Alert } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
    <div className="sd-login">
      <form onSubmit={onSubmit} className="sd-login-form">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h1 className="sd-login-brand">
            Sentry<span>Dock</span>
          </h1>
          <LanguageSwitcher compact />
        </div>
        <p style={{ margin: 0, color: 'var(--sd-muted)', fontSize: 14 }}>{t('login.subtitle')}</p>
        <Field label={t('login.username')}>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </Field>
        <Field label={t('login.password')}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        {error ? <Alert>{error}</Alert> : null}
        <button type="submit" className="sd-btn" disabled={loading} style={{ width: '100%' }}>
          {loading ? t('login.submitting') : t('login.submit')}
        </button>
      </form>
    </div>
  );
}
