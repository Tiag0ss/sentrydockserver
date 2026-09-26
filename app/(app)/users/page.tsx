'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';
import Link from 'next/link';
import {
  PageHeader, Button, Input, Select, Field, Panel, Alert, EmptyState, Modal,
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
      <div className="sd-page sd-page-compact">
        <PageHeader title={t('users.title')} subtitle={t('users.monitorHint')} />
        <Link href="/change-password" className="sd-btn-ghost" style={{ width: 'fit-content' }}>
          {t('users.changeMyPassword')}
        </Link>
      </div>
    );
  }

  return (
    <div className="sd-page sd-page-compact">
      <PageHeader
        title={t('users.title')}
        subtitle={t('users.subtitle')}
        actions={<Button onClick={openCreate}>{t('users.create')}</Button>}
      />
      {error ? <Alert>{error}</Alert> : null}
      {msg ? <Alert tone="ok">{msg}</Alert> : null}

      <Panel className="sd-entity-card">
        <div className="sd-section-head" style={{ marginBottom: 0 }}>
          <div>
            <h2>{t('users.yourAccount')}</h2>
            <p>{me.username} · {tt(t, 'roles', me.role)}</p>
          </div>
          <Link href="/change-password" className="sd-btn-ghost sd-btn-sm">{t('users.changeMyPassword')}</Link>
        </div>
      </Panel>

      <div className="sd-section-head">
        <h2>{t('users.list')}</h2>
      </div>

      {users.length === 0 ? <EmptyState>—</EmptyState> : (
        <div className="sd-entity-list">
          {users.map((u) => (
            <Panel key={u.id} className="sd-entity-card">
              <div className="sd-entity-item">
                <div className="sd-entity-main">
                  <div className="sd-entity-top">
                    <strong className="sd-entity-name">{u.username}</strong>
                    {u.id === me.id ? <span className="sd-entity-muted">({t('users.you')})</span> : null}
                    {u.mustChangePassword ? (
                      <span className="sd-entity-badge" style={{ color: 'var(--sd-warn)' }}>{t('users.mustChange')}</span>
                    ) : null}
                  </div>
                  <div className="sd-entity-meta">{formatDate(u.createdAt)}</div>
                </div>
                <div className="sd-entity-actions">
                  <Select
                    value={u.role}
                    disabled={u.id === me.id}
                    onChange={(e) => { void setRole(u.id, e.target.value); }}
                    className="sd-select"
                    title={tt(t, 'roles', u.role)}
                    style={{ width: 110, minHeight: 32, padding: '4px 8px', fontSize: 12 }}
                  >
                    <option value="modify">{tt(t, 'roles', 'modify')}</option>
                    <option value="monitor">{tt(t, 'roles', 'monitor')}</option>
                  </Select>
                  {resetFor === u.id ? (
                    <>
                      <Input
                        type="password"
                        placeholder={t('users.newPassword')}
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        className="sd-input sd-input-sm"
                        style={{ width: 140 }}
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
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

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
          <Field label={t('users.role')}>
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
