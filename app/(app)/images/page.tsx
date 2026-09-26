'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import {
  PageHeader, Button, Input, Field, EmptyState, Modal, Alert,
} from '@/components/ui';
import { IconButton, IconTrash, IconEdit } from '@/components/IconActions';
import { SearchSelect, type SearchOption } from '../flows/_components/SearchSelect';

type TargetMode = 'follow_tag' | 'pin_tag' | 'semver_range';

type DockerImage = {
  id: string;
  key: string;
  name: string;
  repository: string;
  targetMode: string;
  targetTag: string | null;
  targetRange: string | null;
  allowPrerelease: boolean;
  secretId: string | null;
  placeholder: string;
};

type SecretMeta = { id: string; name: string; type: string };

type ModalMode = 'create' | 'edit' | null;

export default function ImagesPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<DockerImage[]>([]);
  const [secrets, setSecrets] = useState<SecretMeta[]>([]);
  const [listError, setListError] = useState('');
  const [mode, setMode] = useState<ModalMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [repository, setRepository] = useState('');
  const [targetMode, setTargetMode] = useState<TargetMode>('follow_tag');
  const [targetTag, setTargetTag] = useState('');
  const [targetRange, setTargetRange] = useState('');
  const [allowPrerelease, setAllowPrerelease] = useState(false);
  const [secretId, setSecretId] = useState('');

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  async function load() {
    const [images, secs] = await Promise.all([
      api<DockerImage[]>('/docker-images'),
      api<SecretMeta[]>('/secrets'),
    ]);
    setRows(images);
    setSecrets(secs.filter((s) => s.type === 'registry_credentials'));
  }

  useEffect(() => {
    void load().catch((e) => setListError(e instanceof Error ? e.message : t('common.error')));
  }, [t]);

  async function syncFromAgents() {
    setListError('');
    setSyncMsg('');
    setSyncing(true);
    try {
      const res = await api<{
        created: DockerImage[];
        skipped: string[];
        discovered: number;
        agentsQueried: string[];
        agentErrors: Array<{ agentId: string; error: string }>;
      }>('/docker-images/sync', { method: 'POST', body: '{}' });
      await load();
      setSyncMsg(t('images.syncResult', {
        created: String(res.created.length),
        skipped: String(res.skipped.length),
        discovered: String(res.discovered),
        agents: String(res.agentsQueried.length),
      }));
      if (res.agentErrors.length) {
        setListError(res.agentErrors.map((e) => e.error).join('; '));
      }
    } catch (e) {
      setListError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSyncing(false);
    }
  }
  const secretOptions: SearchOption[] = useMemo(
    () => secrets.map((s) => ({ value: s.id, label: s.name })),
    [secrets],
  );

  function resetForm() {
    setKey('');
    setName('');
    setRepository('');
    setTargetMode('follow_tag');
    setTargetTag('');
    setTargetRange('');
    setAllowPrerelease(false);
    setSecretId('');
    setEditingId(null);
    setFormError('');
  }

  function closeModal() {
    setMode(null);
    resetForm();
  }

  function openCreate() {
    resetForm();
    setTargetTag('latest');
    setMode('create');
  }

  function openEdit(r: DockerImage) {
    resetForm();
    setEditingId(r.id);
    setKey(r.key);
    setName(r.name);
    setRepository(r.repository);
    setTargetMode((r.targetMode as TargetMode) || 'follow_tag');
    setTargetTag(r.targetTag || (r.targetMode === 'follow_tag' ? 'latest' : ''));
    setTargetRange(r.targetRange || '');
    setAllowPrerelease(Boolean(r.allowPrerelease));
    setSecretId(r.secretId || '');
    setMode('edit');
  }

  function modeLabel(m: string) {
    if (m === 'pin_tag') return t('images.modePin');
    if (m === 'semver_range') return t('images.modeSemver');
    return t('images.modeFollow');
  }

  async function save() {
    setFormError('');
    if (!key.trim() || !name.trim() || !repository.trim()) {
      setFormError(t('images.requiredFields'));
      return;
    }
    if ((targetMode === 'pin_tag' || targetMode === 'follow_tag') && !targetTag.trim()) {
      setFormError(targetMode === 'pin_tag' ? t('images.pinRequired') : t('images.followTagRequired'));
      return;
    }
    if (targetMode === 'semver_range' && !targetRange.trim()) {
      setFormError(t('images.rangeRequired'));
      return;
    }
    // Repositório sem tag — a tag vive em targetTag (follow/pin)
    const repoOnly = repository.trim().replace(/[@:].*$/, '');
    const body = {
      key: key.trim(),
      name: name.trim(),
      repository: repoOnly,
      targetMode,
      targetTag: (targetMode === 'pin_tag' || targetMode === 'follow_tag')
        ? targetTag.trim()
        : null,
      targetRange: targetMode === 'semver_range' ? targetRange.trim() : null,
      allowPrerelease: targetMode === 'semver_range' ? allowPrerelease : false,
      secretId: secretId || null,
    };
    setSaving(true);
    try {
      if (mode === 'create') {
        await api('/docker-images', { method: 'POST', body: JSON.stringify(body) });
      } else if (editingId) {
        await api(`/docker-images/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
      }
      closeModal();
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string, label: string) {
    if (!window.confirm(t('images.deleteConfirm', { name: label }))) return;
    try {
      await api(`/docker-images/${id}`, { method: 'DELETE' });
      if (editingId === id) closeModal();
      await load();
    } catch (e) {
      setListError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  const canSubmit = Boolean(key.trim() && name.trim() && repository.trim());

  return (
    <div className="sd-page sd-page-compact">
      <PageHeader
        title={t('images.title')}
        subtitle={t('images.subtitle')}
        actions={(
          <>
            <Button variant="ghost" disabled={syncing} onClick={() => { void syncFromAgents(); }}>
              {syncing ? t('images.syncing') : t('images.sync')}
            </Button>
            <Button variant="ghost" onClick={openCreate}>
              + {t('images.create')}
            </Button>
          </>
        )}
      />
      {listError ? <Alert>{listError}</Alert> : null}
      {syncMsg ? <Alert>{syncMsg}</Alert> : null}
      {rows.length === 0 ? <EmptyState>{t('images.empty')}</EmptyState> : (
        <div className="sd-secret-list">
          {rows.map((r) => (
            <div key={r.id} className="sd-secret-row">
              <div className="sd-secret-main">
                <strong className="sd-secret-name">{r.name}</strong>
                <span className="sd-chip">{`\${${r.placeholder}}`}</span>
                <span className="sd-chip sd-chip-muted">
                  {r.targetMode === 'semver_range' && r.targetRange
                    ? `${r.repository} (${r.targetRange})`
                    : r.targetTag
                      ? `${r.repository}:${r.targetTag}`
                      : r.repository}
                </span>
                <span className="sd-chip sd-chip-muted">{modeLabel(r.targetMode)}</span>
              </div>
              <div className="sd-entity-actions">
                <IconButton label={t('images.edit')} onClick={() => openEdit(r)}>
                  <IconEdit />
                </IconButton>
                <IconButton
                  label={t('images.delete')}
                  tone="danger"
                  onClick={() => { void remove(r.id, r.name); }}
                >
                  <IconTrash />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={mode !== null}
        title={mode === 'edit' ? t('images.edit') : t('images.create')}
        onClose={closeModal}
        footer={(
          <>
            <Button variant="ghost" onClick={closeModal}>{t('common.cancel')}</Button>
            <Button disabled={!canSubmit || saving} onClick={() => { void save(); }}>
              {saving ? t('common.loading') : t('common.save')}
            </Button>
          </>
        )}
      >
        {formError ? <Alert>{formError}</Alert> : null}
        <div className="sd-stack">
          <Field label={t('images.key')}>
            <Input
              value={key}
              placeholder="app"
              onChange={(e) => setKey(e.target.value)}
              autoFocus
              autoComplete="off"
            />
          </Field>
          <div style={{ fontSize: 12, color: 'var(--sd-muted)' }}>
            {t('images.keyHint', { placeholder: key.trim() ? `SD_IMAGE_${key.trim()}` : 'SD_IMAGE_app' })}
          </div>
          <Field label={t('images.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={t('images.repository')}>
            <Input
              value={repository}
              placeholder="ghcr.io/org/myapp"
              onChange={(e) => setRepository(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label={t('images.targetMode')}>
            <select
              className="sd-input"
              value={targetMode}
              onChange={(e) => {
                const next = e.target.value as TargetMode;
                setTargetMode(next);
                if (next === 'follow_tag' && !targetTag.trim()) setTargetTag('latest');
              }}
            >
              <option value="follow_tag">{t('images.modeFollow')}</option>
              <option value="pin_tag">{t('images.modePin')}</option>
              <option value="semver_range">{t('images.modeSemver')}</option>
            </select>
          </Field>
          {targetMode === 'follow_tag' ? (
            <>
              <Field label={t('images.followTag')}>
                <Input
                  value={targetTag}
                  placeholder="latest"
                  onChange={(e) => setTargetTag(e.target.value)}
                  autoComplete="off"
                />
              </Field>
              <div style={{ fontSize: 12, color: 'var(--sd-muted)' }}>
                {t('images.followTagHint')}
              </div>
            </>
          ) : null}
          {targetMode === 'pin_tag' ? (
            <>
              <Field label={t('images.targetTag')}>
                <Input value={targetTag} placeholder="1.2.0" onChange={(e) => setTargetTag(e.target.value)} />
              </Field>
              <div style={{ fontSize: 12, color: 'var(--sd-muted)' }}>
                {t('images.pinTagHint')}
              </div>
            </>
          ) : null}
          {targetMode === 'semver_range' ? (
            <>
              <Field label={t('images.targetRange')}>
                <Input value={targetRange} placeholder="^1.2.0" onChange={(e) => setTargetRange(e.target.value)} />
              </Field>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={allowPrerelease}
                  onChange={(e) => setAllowPrerelease(e.target.checked)}
                />
                {t('images.allowPrerelease')}
              </label>
            </>
          ) : null}
          <SearchSelect
            label={t('images.registrySecret')}
            value={secretId}
            options={secretOptions}
            onChange={setSecretId}
            placeholder={t('images.searchSecret')}
            emptyLabel={t('common.none')}
          />
        </div>
      </Modal>
    </div>
  );
}
