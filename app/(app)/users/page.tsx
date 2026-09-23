'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import Link from 'next/link';

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 style={{ margin: 0 }}>{t('users.title')}</h1>
        <p style={{ color: 'var(--muted)' }}>{t('users.monitorHint')}</p>
        <Link href="/change-password" style={{ color: 'var(--accent)' }}>{t('users.changeMyPassword')}</Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 820 }}>
      <header>
        <h1 style={{ margin: 0 }}>{t('users.title')}</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 14 }}>{t('users.subtitle')}</p>
      </header>

      {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
      {msg && <p style={{ color: 'var(--ok)', margin: 0 }}>{msg}</p>}

      <section style={card}>
        <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>{t('users.yourAccount')}</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>{me.username}</strong>
          <Badge>{me.role}</Badge>
          <Link href="/change-password" style={linkBtn}>{t('users.changeMyPassword')}</Link>
        </div>
      </section>

      <section style={card}>
        <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>{t('users.create')}</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            placeholder={t('users.username')}
            value={newUser.username}
            onChange={(e) => setNewUser((s) => ({ ...s, username: e.target.value }))}
            style={input}
          />
          <input
            placeholder={t('users.password')}
            type="password"
            value={newUser.password}
            onChange={(e) => setNewUser((s) => ({ ...s, password: e.target.value }))}
            style={input}
          />
          <select
            value={newUser.role}
            onChange={(e) => setNewUser((s) => ({ ...s, role: e.target.value }))}
            style={input}
          >
            <option value="modify">{t('users.roleModify')}</option>
            <option value="monitor">{t('users.roleMonitor')}</option>
          </select>
          <button type="button" style={btn} onClick={() => void create()}>{t('common.create')}</button>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--muted)' }}>{t('users.createHint')}</p>
      </section>

      <section style={card}>
        <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>{t('users.list')}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {users.map((u) => (
            <div key={u.id} style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              flexWrap: 'wrap',
              padding: '10px 0',
              borderBottom: '1px solid var(--border)',
            }}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ fontWeight: 600 }}>
                  {u.username}
                  {u.id === me.id && (
                    <span style={{ color: 'var(--muted)', fontWeight: 400, marginLeft: 6 }}>({t('users.you')})</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {formatDate(u.createdAt)}
                  {u.mustChangePassword && <> · {t('users.mustChange')}</>}
                </div>
              </div>

              <select
                value={u.role}
                disabled={u.id === me.id}
                onChange={(e) => void setRole(u.id, e.target.value)}
                style={{ ...input, width: 140 }}
              >
                <option value="modify">{t('users.roleModify')}</option>
                <option value="monitor">{t('users.roleMonitor')}</option>
              </select>

              {resetFor === u.id ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="password"
                    placeholder={t('users.newPassword')}
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    style={input}
                  />
                  <button type="button" style={btn} onClick={() => void resetPwd(u.id)}>{t('common.save')}</button>
                  <button type="button" style={btnGhost} onClick={() => { setResetFor(null); setResetPassword(''); }}>{t('common.back')}</button>
                </div>
              ) : (
                <button type="button" style={btnGhost} onClick={() => setResetFor(u.id)}>
                  {t('users.resetPassword')}
                </button>
              )}

              <button
                type="button"
                disabled={u.id === me.id}
                onClick={() => void remove(u.id, u.username)}
                style={{
                  ...btnGhost,
                  color: 'var(--danger)',
                  borderColor: 'var(--danger)',
                  opacity: u.id === me.id ? 0.4 : 1,
                }}
              >
                {t('common.delete')}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 12,
      fontFamily: 'IBM Plex Mono, monospace',
      border: '1px solid var(--accent)',
      color: 'var(--accent)',
      borderRadius: 999,
      padding: '2px 8px',
    }}>{children}</span>
  );
}

const card: React.CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 16,
};
const input: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '8px 10px',
  color: 'var(--text)',
};
const btn: React.CSSProperties = {
  background: 'var(--accent)',
  color: 'var(--bg)',
  border: 'none',
  borderRadius: 8,
  padding: '8px 12px',
  fontWeight: 600,
  cursor: 'pointer',
};
const btnGhost: React.CSSProperties = {
  ...btn,
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
};
const linkBtn: React.CSSProperties = {
  ...btnGhost,
  display: 'inline-block',
  textDecoration: 'none',
};
