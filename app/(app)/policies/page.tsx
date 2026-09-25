'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { SearchSelect, type SearchOption } from '../flows/_components/SearchSelect';
import {
  PageHeader, Button, Input, Select, Field, Tabs, Alert, EmptyState, DataRow, Panel, Modal,
} from '@/components/ui';
import {
  IconButton, IconTrash, IconEdit, IconPower, IconCheck, IconDownload, IconUpload,
} from '@/components/IconActions';

type Watch = {
  id: string;
  agentId: string;
  containerName: string;
  image: string;
  secretId: string | null;
};
type Policy = {
  id: string;
  name: string;
  watchId: string;
  flowId: string;
  cron: string;
  timezone: string;
  mode: string;
  enabled: boolean;
  blackoutStart: string | null;
  blackoutEnd: string | null;
  nextRunAt: string | Date | null;
  lastRunAt: string | Date | null;
};
type Agent = { id: string; name: string; online?: boolean };
type Flow = { id: string; name: string };
type Secret = { id: string; name: string };
type ContainerRow = {
  id: string;
  name?: string;
  names?: string[];
  image: string;
  imageId?: string;
  configImage?: string;
  state?: string;
  status?: string;
  composeProject?: string;
  composeService?: string;
};

type TabId = 'watches' | 'policies' | 'io';

const emptyPolicyForm = {
  name: '',
  watchId: '',
  flowId: '',
  cron: '0 */6 * * *',
  timezone: 'Europe/Lisbon',
  mode: 'notify' as 'auto' | 'notify',
  blackoutStart: '',
  blackoutEnd: '',
  enabled: true,
};

function containerNameOf(c: ContainerRow): string {
  return (c.name || c.names?.[0] || c.id).replace(/^\//, '');
}

function isImageIdRef(value: string | undefined | null): boolean {
  if (!value) return false;
  const v = String(value).trim();
  return /^sha256:[a-f0-9]+$/i.test(v) || /^[a-f0-9]{64}$/i.test(v);
}

function preferImageName(...candidates: Array<string | undefined | null>): string {
  for (const c of candidates) {
    const v = c ? String(c).trim() : '';
    if (v && !isImageIdRef(v)) return v;
  }
  for (const c of candidates) {
    const v = c ? String(c).trim() : '';
    if (v) return v;
  }
  return '';
}

export default function PoliciesPage() {
  const { t, formatDate } = useI18n();
  const [tab, setTab] = useState<TabId>('watches');
  const [watches, setWatches] = useState<Watch[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [containersError, setContainersError] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [watchOpen, setWatchOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [watchForm, setWatchForm] = useState({
    agentId: '',
    containerName: '',
    image: '',
    secretId: '',
  });
  const [policyForm, setPolicyForm] = useState(emptyPolicyForm);

  const load = useCallback(async () => {
    const [w, p, a, f, s] = await Promise.all([
      api<Watch[]>('/watches'),
      api<Policy[]>('/policies'),
      api<Agent[]>('/agents'),
      api<Flow[]>('/flows'),
      api<Secret[]>('/secrets'),
    ]);
    setWatches(w);
    setPolicies(p);
    setAgents(a);
    setFlows(f);
    setSecrets(s);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : t('common.error')));
  }, [load, t]);

  useEffect(() => {
    if (!watchForm.agentId || !watchOpen) {
      if (!watchForm.agentId) {
        setContainers([]);
        setContainersError('');
      }
      return;
    }
    let cancelled = false;
    setLoadingContainers(true);
    setContainersError('');
    void (async () => {
      try {
        const list = await api<ContainerRow[]>(`/agents/${watchForm.agentId}/containers`);
        if (!cancelled) setContainers(Array.isArray(list) ? list : []);
      } catch (e) {
        if (!cancelled) {
          setContainers([]);
          setContainersError(e instanceof Error ? e.message : t('policies.containersLoadError'));
        }
      } finally {
        if (!cancelled) setLoadingContainers(false);
      }
    })();
    return () => { cancelled = true; };
  }, [watchForm.agentId, watchOpen, t]);

  const containerOptions: SearchOption[] = useMemo(
    () => containers.map((c) => {
      const name = containerNameOf(c);
      const compose = c.composeProject && c.composeService
        ? `${c.composeProject}/${c.composeService}`
        : null;
      return {
        value: name,
        label: name,
        hint: [compose, preferImageName(c.configImage, c.image), c.state || c.status].filter(Boolean).join(' · '),
      };
    }),
    [containers],
  );

  const agentOptions: SearchOption[] = useMemo(
    () => agents.map((a) => ({
      value: a.id,
      label: a.name,
      hint: a.online ? t('agents.online') : t('agents.offline'),
    })),
    [agents, t],
  );

  const secretOptions: SearchOption[] = useMemo(
    () => [
      { value: '', label: t('common.none') },
      ...secrets.map((s) => ({ value: s.id, label: s.name })),
    ],
    [secrets, t],
  );

  const watchOptions: SearchOption[] = useMemo(
    () => watches.map((w) => ({
      value: w.id,
      label: w.containerName,
      hint: `${w.image} · ${agents.find((a) => a.id === w.agentId)?.name || w.agentId.slice(0, 8)}`,
    })),
    [watches, agents],
  );

  const flowOptions: SearchOption[] = useMemo(
    () => flows.map((f) => ({ value: f.id, label: f.name })),
    [flows],
  );

  function selectContainer(name: string) {
    const c = containers.find((x) => containerNameOf(x) === name);
    const fromContainer = preferImageName(c?.configImage, c?.image);
    setWatchForm((s) => {
      const keep = s.image && !isImageIdRef(s.image) ? s.image : '';
      const image = fromContainer && !isImageIdRef(fromContainer) ? fromContainer : (keep || fromContainer || s.image);
      return { ...s, containerName: name, image };
    });
  }

  function openWatchCreate() {
    setWatchForm({
      agentId: agents[0]?.id || '',
      containerName: '',
      image: '',
      secretId: '',
    });
    setFormError('');
    setWatchOpen(true);
  }

  function openPolicyCreate() {
    setEditingId(null);
    setPolicyForm({
      ...emptyPolicyForm,
      watchId: watches[0]?.id || '',
      flowId: flows[0]?.id || '',
    });
    setFormError('');
    setPolicyOpen(true);
  }

  function startEdit(p: Policy) {
    setEditingId(p.id);
    setPolicyForm({
      name: p.name,
      watchId: p.watchId,
      flowId: p.flowId,
      cron: p.cron,
      timezone: p.timezone,
      mode: p.mode === 'auto' ? 'auto' : 'notify',
      blackoutStart: p.blackoutStart || '',
      blackoutEnd: p.blackoutEnd || '',
      enabled: p.enabled,
    });
    setFormError('');
    setTab('policies');
    setPolicyOpen(true);
  }

  async function createWatch() {
    setFormError('');
    if (!watchForm.agentId || !watchForm.containerName || !watchForm.image) {
      setFormError(t('policies.watchIncomplete'));
      return;
    }
    setSaving(true);
    try {
      await api('/watches', {
        method: 'POST',
        body: JSON.stringify({
          agentId: watchForm.agentId,
          containerName: watchForm.containerName,
          image: watchForm.image,
          secretId: watchForm.secretId || null,
        }),
      });
      setWatchOpen(false);
      setMsg(t('policies.watchCreated'));
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  async function savePolicy() {
    setFormError('');
    if (!policyForm.watchId || !policyForm.flowId) {
      setFormError(t('policies.policyIncomplete'));
      return;
    }
    const watch = watches.find((w) => w.id === policyForm.watchId);
    const name = policyForm.name.trim()
      || (watch ? `${watch.containerName} · ${policyForm.mode}` : 'Policy');
    const body = {
      ...policyForm,
      name,
      blackoutStart: policyForm.blackoutStart || null,
      blackoutEnd: policyForm.blackoutEnd || null,
    };
    setSaving(true);
    try {
      if (editingId) {
        await api(`/policies/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
        setMsg(t('policies.policyUpdated'));
      } else {
        await api('/policies', { method: 'POST', body: JSON.stringify(body) });
        setMsg(t('policies.policyCreated'));
      }
      setPolicyOpen(false);
      setEditingId(null);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  }

  async function togglePolicy(p: Policy) {
    setError('');
    try {
      await api(`/policies/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !p.enabled }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  async function runCheck(id: string) {
    setMsg('');
    setError('');
    try {
      const res = await api<{ updateAvailable?: boolean }>(`/policies/${id}/check`, {
        method: 'POST',
        body: '{}',
      });
      setMsg(res.updateAvailable ? t('policies.checkHasUpdate') : t('policies.checkNoUpdate'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  async function exportBundle() {
    setError('');
    try {
      const data = await api('/ops/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sentrydock-ops-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  async function importBundle(file: File) {
    setError('');
    setMsg('');
    try {
      const text = await file.text();
      const data = JSON.parse(text) as unknown;
      const res = await api<{ watches: number; policies: number; templates: number }>('/ops/import', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      setMsg(t('policies.imported', {
        watches: res.watches,
        policies: res.policies,
        templates: res.templates,
      }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name || id.slice(0, 8);
  const flowName = (id: string) => flows.find((f) => f.id === id)?.name || id.slice(0, 8);
  const watchLabel = (id: string) => {
    const w = watches.find((x) => x.id === id);
    return w ? `${w.containerName} · ${w.image}` : id.slice(0, 8);
  };

  return (
    <div className="sd-page">
      <PageHeader title={t('policies.title')} subtitle={t('policies.subtitle')} />

      <Tabs
        value={tab}
        onChange={(id) => setTab(id as TabId)}
        items={[
          { id: 'watches', label: t('policies.tabWatches'), count: watches.length },
          { id: 'policies', label: t('policies.tabPolicies'), count: policies.length },
          { id: 'io', label: t('policies.tabImportExport') },
        ]}
      />

      {error ? <Alert>{error}</Alert> : null}
      {msg ? <Alert tone="ok">{msg}</Alert> : null}

      {tab === 'watches' && (
        <Panel>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('policies.watches')}</h2>
              <p style={{ margin: 0, color: 'var(--sd-muted)', fontSize: 13 }}>{t('policies.watchesHint')}</p>
            </div>
            <Button onClick={openWatchCreate}>{t('policies.addWatch')}</Button>
          </div>
          {watches.length === 0 ? <EmptyState>{t('policies.noWatches')}</EmptyState> : null}
          {watches.map((w) => (
            <DataRow
              key={w.id}
              title={w.containerName}
              meta={`${w.image} · ${agentName(w.agentId)}`}
              actions={(
                <IconButton
                  label={t('common.delete')}
                  tone="danger"
                  onClick={async () => {
                    if (!confirm(t('policies.deleteWatchConfirm'))) return;
                    try {
                      await api(`/watches/${w.id}`, { method: 'DELETE' });
                      await load();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : t('common.error'));
                    }
                  }}
                >
                  <IconTrash />
                </IconButton>
              )}
            />
          ))}
        </Panel>
      )}

      {tab === 'policies' && (
        <Panel>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('policies.policies')}</h2>
              <p style={{ margin: 0, color: 'var(--sd-muted)', fontSize: 13 }}>{t('policies.policiesHint')}</p>
            </div>
            {watches.length > 0 ? (
              <Button onClick={openPolicyCreate}>{t('policies.addPolicy')}</Button>
            ) : null}
          </div>

          {watches.length === 0 ? (
            <EmptyState>
              {t('policies.needWatchFirst')}{' '}
              <Button variant="ghost" onClick={() => setTab('watches')} style={{ marginLeft: 8 }}>
                {t('policies.tabWatches')}
              </Button>
            </EmptyState>
          ) : null}

          {policies.length === 0 && watches.length > 0 ? (
            <EmptyState>{t('policies.noPolicies')}</EmptyState>
          ) : null}
          {policies.map((p) => (
            <DataRow
              key={p.id}
              title={p.name}
              meta={(
                <>
                  {watchLabel(p.watchId)} · {flowName(p.flowId)} · {p.cron} ({p.timezone}) · {p.mode}
                  {p.blackoutStart && p.blackoutEnd ? ` · ${p.blackoutStart}–${p.blackoutEnd}` : ''}
                  <br />
                  {t('policies.nextRun')}: {p.nextRunAt ? formatDate(p.nextRunAt) : '—'}
                  {p.lastRunAt ? ` · ${t('policies.lastRun')}: ${formatDate(p.lastRunAt)}` : ''}
                </>
              )}
              actions={(
                <>
                  <IconButton label={t('common.edit')} onClick={() => startEdit(p)}>
                    <IconEdit />
                  </IconButton>
                  <IconButton
                    label={p.enabled ? t('policies.disable') : t('policies.enable')}
                    tone={p.enabled ? 'warn' : 'primary'}
                    onClick={() => { void togglePolicy(p); }}
                  >
                    <IconPower />
                  </IconButton>
                  <IconButton label={t('policies.checkNow')} onClick={() => { void runCheck(p.id); }}>
                    <IconCheck />
                  </IconButton>
                  <IconButton
                    label={t('common.delete')}
                    tone="danger"
                    onClick={async () => {
                      if (!confirm(t('policies.deletePolicyConfirm', { name: p.name }))) return;
                      try {
                        await api(`/policies/${p.id}`, { method: 'DELETE' });
                        if (editingId === p.id) {
                          setEditingId(null);
                          setPolicyOpen(false);
                        }
                        await load();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : t('common.error'));
                      }
                    }}
                  >
                    <IconTrash />
                  </IconButton>
                </>
              )}
            />
          ))}
        </Panel>
      )}

      {tab === 'io' && (
        <Panel>
          <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>{t('policies.tabImportExport')}</h2>
          <div className="sd-stack" style={{ maxWidth: 480 }}>
            <div>
              <p style={{ margin: '0 0 8px', color: 'var(--sd-muted)', fontSize: 13 }}>{t('policies.exportHint')}</p>
              <IconButton label={t('policies.export')} onClick={() => { void exportBundle(); }}>
                <IconDownload />
              </IconButton>
            </div>
            <div>
              <p style={{ margin: '0 0 8px', color: 'var(--sd-muted)', fontSize: 13 }}>{t('policies.importHint')}</p>
              <label
                className="sd-icon-btn"
                title={t('policies.import')}
                aria-label={t('policies.import')}
                data-tooltip={t('policies.import')}
                style={{ cursor: 'pointer' }}
              >
                <IconUpload />
                <input
                  type="file"
                  accept="application/json,.json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importBundle(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        </Panel>
      )}

      <Modal
        open={watchOpen}
        title={t('policies.addWatch')}
        onClose={() => setWatchOpen(false)}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setWatchOpen(false)}>{t('common.cancel')}</Button>
            <Button
              disabled={!watchForm.containerName || !watchForm.image || saving}
              onClick={() => { void createWatch(); }}
            >
              {saving ? t('common.loading') : t('common.create')}
            </Button>
          </>
        )}
      >
        {formError ? <Alert>{formError}</Alert> : null}
        {containersError ? <Alert>{containersError}</Alert> : null}
        <div className="sd-stack">
          <SearchSelect
            label={t('inspector.agent')}
            value={watchForm.agentId}
            options={agentOptions}
            onChange={(v) => setWatchForm((s) => ({ ...s, agentId: v, containerName: '', image: '' }))}
            emptyLabel={t('inspector.selectAgent')}
            placeholder={t('inspector.searchAgent')}
          />
          <SearchSelect
            label={t('inspector.container')}
            value={watchForm.containerName}
            options={containerOptions}
            onChange={selectContainer}
            emptyLabel={watchForm.agentId ? t('inspector.selectContainer') : t('inspector.pickAgentFirst')}
            placeholder={t('inspector.searchContainer')}
            disabled={!watchForm.agentId}
            loading={loadingContainers}
          />
          <Field label={t('policies.image')}>
            <Input
              value={watchForm.image}
              onChange={(e) => setWatchForm((s) => ({ ...s, image: e.target.value }))}
              placeholder="registry/app:tag"
            />
            <span style={{ color: 'var(--sd-muted)', fontSize: 12 }}>{t('policies.imageHint')}</span>
          </Field>
          <SearchSelect
            label={t('inspector.secret')}
            value={watchForm.secretId}
            options={secretOptions}
            onChange={(v) => setWatchForm((s) => ({ ...s, secretId: v }))}
            emptyLabel={t('common.none')}
            placeholder={t('inspector.searchSecret')}
          />
        </div>
      </Modal>

      <Modal
        open={policyOpen}
        title={editingId ? t('policies.savePolicy') : t('policies.addPolicy')}
        onClose={() => { setPolicyOpen(false); setEditingId(null); }}
        wide
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setPolicyOpen(false); setEditingId(null); }}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!policyForm.watchId || !policyForm.flowId || saving}
              onClick={() => { void savePolicy(); }}
            >
              {saving ? t('common.loading') : (editingId ? t('common.save') : t('common.create'))}
            </Button>
          </>
        )}
      >
        {formError ? <Alert>{formError}</Alert> : null}
        <div className="sd-stack">
          <SearchSelect
            label={t('policies.selectWatch')}
            value={policyForm.watchId}
            options={watchOptions}
            onChange={(v) => setPolicyForm((s) => ({ ...s, watchId: v }))}
            emptyLabel={t('policies.selectWatch')}
            placeholder={t('common.search')}
          />
          <SearchSelect
            label={t('policies.selectFlow')}
            value={policyForm.flowId}
            options={flowOptions}
            onChange={(v) => setPolicyForm((s) => ({ ...s, flowId: v }))}
            emptyLabel={t('policies.selectFlow')}
            placeholder={t('common.search')}
          />
          <div className="sd-form-row">
            <Field label={t('policies.modeNotify')}>
              <Select
                value={policyForm.mode}
                onChange={(e) => setPolicyForm((s) => ({ ...s, mode: e.target.value as 'auto' | 'notify' }))}
              >
                <option value="notify">{t('policies.modeNotify')}</option>
                <option value="auto">{t('policies.modeAuto')}</option>
              </Select>
            </Field>
            <Field label={t('policies.cron')}>
              <Input
                value={policyForm.cron}
                onChange={(e) => setPolicyForm((s) => ({ ...s, cron: e.target.value }))}
                title={t('policies.cronHint')}
              />
            </Field>
            <Field label={t('policies.timezone')}>
              <Input
                value={policyForm.timezone}
                onChange={(e) => setPolicyForm((s) => ({ ...s, timezone: e.target.value }))}
              />
            </Field>
          </div>
          <div className="sd-form-row">
            <Field label={t('policies.blackoutStart')}>
              <Input
                value={policyForm.blackoutStart}
                onChange={(e) => setPolicyForm((s) => ({ ...s, blackoutStart: e.target.value }))}
                placeholder="HH:mm"
              />
            </Field>
            <Field label={t('policies.blackoutEnd')}>
              <Input
                value={policyForm.blackoutEnd}
                onChange={(e) => setPolicyForm((s) => ({ ...s, blackoutEnd: e.target.value }))}
                placeholder="HH:mm"
              />
            </Field>
            <Field label={t('policies.policyNameOptional')}>
              <Input
                value={policyForm.name}
                onChange={(e) => setPolicyForm((s) => ({ ...s, name: e.target.value }))}
              />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}
