'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import Link from 'next/link';
import {
  PageHeader, Button, Input, Select, Field, Panel, DataRow, Alert, Badge, EmptyState,
} from '@/components/ui';

type UserRow = {
  id: string;
  username: string;
  role: string;
  mustChangePassword: boolean;
  createdAt: string;
};

type Me = { id: string; username: string; role: string; mustChangePassword: boolean };

export default function UsersPage() {
  const { t, formatDate } = useI18n();
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'monitor' });
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const meRes = await api<{ user: Me }>('/auth/me');
      setMe(meRes.user);
      if (meRes.user.role === 'modify') {
        setUsers(await api<UserRow[]>('/users'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    setMsg('');
    setError('');
    try {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: newUser.username,
          password: newUser.password,
          role: newUser.role,
          mustChangePassword: true,
        }),
      });
      setNewUser({ username: '', password: '', role: 'monitor' });
      setMsg(t('users.created'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  async function setRole(id: string, role: string) {
    setError('');
    try {
      await api(`/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  async function resetPwd(id: string) {
    setError('');
    try {
      await api(`/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ password: resetPassword, mustChangePassword: true }),
      });
      setResetFor(null);
      setResetPassword('');
      setMsg(t('users.passwordReset'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  async function remove(id: string, username: string) {
    if (!window.confirm(t('users.deleteConfirm', { name: username }))) return;
    setError('');
    try {
      await api(`/users/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  if (!me) return <p>{t('common.loading')}</p>;

  if (me.role !== 'modify') {
    return (
      <div className="sd-page">
        <PageHeader title={t('users.title')} subtitle={t('users.monitorHint')} />
        <Link href="/change-password" className="sd-btn-ghost" style={{ width: 'fit-content' }}>
          {t('users.changeMyPassword')}
        </Link>
      </div>
    );
  }

  return (
    <div className="sd-page">
      <PageHeader title={t('users.title')} subtitle={t('users.subtitle')} />
      {error ? <Alert>{error}</Alert> : null}
      {msg ? <Alert tone="ok">{msg}</Alert> : null}

      <Panel>
        <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>{t('users.yourAccount')}</h2>
        <div className="sd-actions" style={{ alignItems: 'center' }}>
          <strong>{me.username}</strong>
          <Badge tone="accent">{tt(t, 'roles', me.role)}</Badge>
          <Link href="/change-password" className="sd-btn-ghost">{t('users.changeMyPassword')}</Link>
        </div>
      </Panel>

      <Panel>
        <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>{t('users.create')}</h2>
        <div className="sd-form-row">
          <Field label={t('users.username')}>
            <Input value={newUser.username} onChange={(e) => setNewUser((s) => ({ ...s, username: e.target.value }))} />
          </Field>
          <Field label={t('users.password')}>
            <Input type="password" value={newUser.password} onChange={(e) => setNewUser((s) => ({ ...s, password: e.target.value }))} />
          </Field>
          <Field label="Role">
            <Select value={newUser.role} onChange={(e) => setNewUser((s) => ({ ...s, role: e.target.value }))}>
              <option value="modify">{t('users.roleModify')}</option>
              <option value="monitor">{t('users.roleMonitor')}</option>
            </Select>
          </Field>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button onClick={() => { void create(); }}>{t('common.create')}</Button>
          </div>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--sd-muted)' }}>{t('users.createHint')}</p>
      </Panel>

      <Panel>
        <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>{t('users.list')}</h2>
        {users.length === 0 ? <EmptyState>—</EmptyState> : null}
        {users.map((u) => (
          <DataRow
            key={u.id}
            title={(
              <>
                {u.username}
                {u.id === me.id ? <span style={{ color: 'var(--sd-muted)', fontWeight: 400 }}> ({t('users.you')})</span> : null}
              </>
            )}
            meta={(
              <>
                {formatDate(u.createdAt)}
                {u.mustChangePassword ? ` · ${t('users.mustChange')}` : ''}
              </>
            )}
            actions={(
              <>
                <Select
                  value={u.role}
                  disabled={u.id === me.id}
                  onChange={(e) => { void setRole(u.id, e.target.value); }}
                  style={{ width: 140 }}
                >
                  <option value="modify">{t('users.roleModify')}</option>
                  <option value="monitor">{t('users.roleMonitor')}</option>
                </Select>
                {resetFor === u.id ? (
                  <>
                    <Input
                      type="password"
                      placeholder={t('users.newPassword')}
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      style={{ minWidth: 140 }}
                    />
                    <Button onClick={() => { void resetPwd(u.id); }}>{t('common.save')}</Button>
                    <Button variant="ghost" onClick={() => { setResetFor(null); setResetPassword(''); }}>{t('common.back')}</Button>
                  </>
                ) : (
                  <Button variant="ghost" onClick={() => setResetFor(u.id)}>{t('users.resetPassword')}</Button>
                )}
                <Button
                  variant="danger"
                  disabled={u.id === me.id}
                  onClick={() => { void remove(u.id, u.username); }}
                >
                  {t('common.delete')}
                </Button>
              </>
            )}
          />
        ))}
      </Panel>
    </div>
  );
}
