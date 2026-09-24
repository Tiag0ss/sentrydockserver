'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { SearchSelect, type SearchOption } from '../flows/_components/SearchSelect';
import {
  PageHeader, Button, Input, Select, Field, Tabs, Alert, EmptyState, DataRow, Panel,
} from '@/components/ui';

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
  const [editingId, setEditingId] = useState<string | null>(null);

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
    setWatchForm((prev) => ({ ...prev, agentId: prev.agentId || a[0]?.id || '' }));
    setPolicyForm((prev) => ({
      ...prev,
      watchId: prev.watchId || w[0]?.id || '',
      flowId: prev.flowId || f[0]?.id || '',
    }));
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : t('common.error')));
  }, [load, t]);

  useEffect(() => {
    if (!watchForm.agentId) {
      setContainers([]);
      setContainersError('');
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
  }, [watchForm.agentId, t]);

  const containerOptions: SearchOption[] = useMemo(
    () => containers.map((c) => {
      const name = containerNameOf(c);
      const compose = c.composeProject && c.composeService
        ? `${c.composeProject}/${c.composeService}`
        : null;
      return {
        value: name,
        label: name,
        hint: [compose, c.image, c.state || c.status].filter(Boolean).join(' · '),
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
    setWatchForm((s) => ({ ...s, containerName: name, image: c?.image || s.image }));
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
    setTab('policies');
    setError('');
    setMsg('');
  }

  function resetPolicyForm() {
    setEditingId(null);
    setPolicyForm({
      ...emptyPolicyForm,
      watchId: watches[0]?.id || '',
      flowId: flows[0]?.id || '',
    });
  }

  async function createWatch() {
    setError('');
    setMsg('');
    if (!watchForm.agentId || !watchForm.containerName || !watchForm.image) {
      setError(t('policies.watchIncomplete'));
      return;
    }
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
      setMsg(t('policies.watchCreated'));
      setWatchForm((s) => ({ ...s, containerName: '', image: '' }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
    }
  }

  async function savePolicy() {
    setError('');
    setMsg('');
    if (!policyForm.watchId || !policyForm.flowId) {
      setError(t('policies.policyIncomplete'));
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
    try {
      if (editingId) {
        await api(`/policies/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
        setMsg(t('policies.policyUpdated'));
      } else {
        await api('/policies', { method: 'POST', body: JSON.stringify(body) });
        setMsg(t('policies.policyCreated'));
      }
      resetPolicyForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'));
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
          <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('policies.watches')}</h2>
          <p style={{ margin: '0 0 14px', color: 'var(--sd-muted)', fontSize: 13 }}>{t('policies.watchesHint')}</p>
          <div className="sd-stack" style={{ maxWidth: 560, marginBottom: 16 }}>
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
            {containersError ? <Alert>{containersError}</Alert> : null}
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
            <Button
              disabled={!watchForm.containerName || !watchForm.image}
              onClick={() => { void createWatch(); }}
              style={{ width: 'fit-content' }}
            >
              {t('policies.addWatch')}
            </Button>
          </div>
          {watches.length === 0 ? <EmptyState>{t('policies.noWatches')}</EmptyState> : null}
          {watches.map((w) => (
            <DataRow
              key={w.id}
              title={w.containerName}
              meta={`${w.image} · ${agentName(w.agentId)}`}
              actions={(
                <Button
                  variant="danger"
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
                  {t('common.delete')}
                </Button>
              )}
            />
          ))}
        </Panel>
      )}

      {tab === 'policies' && (
        <Panel>
          <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('policies.policies')}</h2>
          <p style={{ margin: '0 0 14px', color: 'var(--sd-muted)', fontSize: 13 }}>{t('policies.policiesHint')}</p>

          {watches.length === 0 ? (
            <EmptyState>
              {t('policies.needWatchFirst')}{' '}
              <Button variant="ghost" onClick={() => setTab('watches')} style={{ marginLeft: 8 }}>
                {t('policies.tabWatches')}
              </Button>
            </EmptyState>
          ) : (
            <div className="sd-stack" style={{ maxWidth: 640, marginBottom: 20 }}>
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
              <div className="sd-actions">
                <Button onClick={() => { void savePolicy(); }}>
                  {editingId ? t('policies.savePolicy') : t('policies.addPolicy')}
                </Button>
                {editingId ? (
                  <Button variant="ghost" onClick={resetPolicyForm}>{t('policies.cancelEdit')}</Button>
                ) : null}
              </div>
            </div>
          )}

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
                  <Button variant="ghost" onClick={() => startEdit(p)}>{t('common.edit')}</Button>
                  <Button variant="ghost" onClick={() => { void togglePolicy(p); }}>
                    {p.enabled ? t('policies.disable') : t('policies.enable')}
                  </Button>
                  <Button variant="ghost" onClick={() => { void runCheck(p.id); }}>
                    {t('policies.checkNow')}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={async () => {
                      if (!confirm(t('policies.deletePolicyConfirm', { name: p.name }))) return;
                      try {
                        await api(`/policies/${p.id}`, { method: 'DELETE' });
                        if (editingId === p.id) resetPolicyForm();
                        await load();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : t('common.error'));
                      }
                    }}
                  >
                    {t('common.delete')}
                  </Button>
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
              <Button variant="ghost" onClick={() => { void exportBundle(); }}>{t('policies.export')}</Button>
            </div>
            <div>
              <p style={{ margin: '0 0 8px', color: 'var(--sd-muted)', fontSize: 13 }}>{t('policies.importHint')}</p>
              <label className="sd-btn-ghost" style={{ display: 'inline-flex', cursor: 'pointer' }}>
                {t('policies.import')}
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
    </div>
  );
}
