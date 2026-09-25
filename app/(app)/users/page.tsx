'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import Link from 'next/link';
import {
  PageHeader, Button, Input, Select, Field, Panel, DataRow, Alert, Badge, EmptyState, Modal,
} from '@/components/ui';
import { IconButton, IconTrash, IconKey, IconSave, IconClose } from '@/components/IconActions';

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
  const [open, setOpen] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'monitor' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
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

  function openCreate() {
    setNewUser({ username: '', password: '', role: 'monitor' });
    setFormError('');
    setOpen(true);
  }

  async function create() {
    setFormError('');
    setSaving(true);
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
      setOpen(false);
      setMsg(t('users.created'));
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
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
      <PageHeader
        title={t('users.title')}
        subtitle={t('users.subtitle')}
        actions={<Button onClick={openCreate}>{t('users.create')}</Button>}
      />
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
                    <IconButton label={t('common.save')} tone="primary" onClick={() => { void resetPwd(u.id); }}>
                      <IconSave />
                    </IconButton>
                    <IconButton label={t('common.back')} onClick={() => { setResetFor(null); setResetPassword(''); }}>
                      <IconClose />
                    </IconButton>
                  </>
                ) : (
                  <IconButton label={t('users.resetPassword')} onClick={() => setResetFor(u.id)}>
                    <IconKey />
                  </IconButton>
                )}
                <IconButton
                  label={t('common.delete')}
                  tone="danger"
                  disabled={u.id === me.id}
                  onClick={() => { void remove(u.id, u.username); }}
                >
                  <IconTrash />
                </IconButton>
              </>
            )}
          />
        ))}
      </Panel>

      <Modal
        open={open}
        title={t('users.create')}
        onClose={() => setOpen(false)}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button
              disabled={!newUser.username.trim() || !newUser.password || saving}
              onClick={() => { void create(); }}
            >
              {saving ? t('common.loading') : t('common.create')}
            </Button>
          </>
        )}
      >
        {formError ? <Alert>{formError}</Alert> : null}
        <div className="sd-stack">
          <Field label={t('users.username')}>
            <Input value={newUser.username} onChange={(e) => setNewUser((s) => ({ ...s, username: e.target.value }))} autoFocus />
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
          <p style={{ margin: 0, fontSize: 12, color: 'var(--sd-muted)' }}>{t('users.createHint')}</p>
        </div>
      </Modal>
    </div>
  );
}
