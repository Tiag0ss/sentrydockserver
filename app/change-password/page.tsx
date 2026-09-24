'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken, getToken, clearToken } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { Field, Input, Button, Alert } from '@/components/ui';

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
    <div className="sd-login">
      <form onSubmit={onSubmit} className="sd-login-form">
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>{t('users.changePasswordTitle')}</h1>
        {forced ? (
          <Alert tone="warn">{t('users.mustChangeHint')}</Alert>
        ) : null}
        <Field label={t('users.currentPassword')}>
          <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </Field>
        <Field label={t('users.newPassword')}>
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
        </Field>
        <Field label={t('users.confirmPassword')}>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={6} />
        </Field>
        {error ? <Alert>{error}</Alert> : null}
        <button type="submit" className="sd-btn" disabled={loading} style={{ width: '100%' }}>
          {loading ? t('common.loading') : t('users.savePassword')}
        </button>
        {!forced ? (
          <Button variant="ghost" onClick={() => router.back()} style={{ width: '100%' }}>
            {t('common.back')}
          </Button>
        ) : null}
      </form>
    </div>
  );
}
