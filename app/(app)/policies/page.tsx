'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { SearchSelect, type SearchOption } from '../flows/_components/SearchSelect';

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

const input: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '8px 10px',
  color: 'var(--text)',
};
const btn: React.CSSProperties = {
  background: 'var(--accent)',
  border: 'none',
  borderRadius: 8,
  padding: '8px 12px',
  fontWeight: 600,
  cursor: 'pointer',
  color: 'var(--bg)',
};
const btnGhost: React.CSSProperties = {
  ...btn,
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
};
const card: React.CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 16,
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
    setWatchForm((prev) => ({
      ...prev,
      agentId: prev.agentId || a[0]?.id || '',
    }));
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
    setWatchForm((s) => ({
      ...s,
      containerName: name,
      image: c?.image || s.image,
    }));
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
        await api(`/policies/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        setMsg(t('policies.policyUpdated'));
      } else {
        await api('/policies', {
          method: 'POST',
          body: JSON.stringify(body),
        });
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

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'watches', label: t('policies.tabWatches'), count: watches.length },
    { id: 'policies', label: t('policies.tabPolicies'), count: policies.length },
    { id: 'io', label: t('policies.tabImportExport') },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header>
        <h1 style={{ margin: 0 }}>{t('policies.title')}</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 14 }}>{t('policies.subtitle')}</p>
      </header>

      <nav
        role="tablist"
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
        }}
      >
        {tabs.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(item.id)}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
                padding: '10px 14px',
                color: active ? 'var(--text)' : 'var(--muted)',
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              {item.label}
              {item.count != null ? (
                <span style={{ marginLeft: 8, color: 'var(--muted)', fontWeight: 500 }}>{item.count}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
      {msg && <p style={{ color: 'var(--ok)', margin: 0 }}>{msg}</p>}

      {tab === 'watches' && (
        <section style={card}>
          <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('policies.watches')}</h2>
          <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: 13 }}>{t('policies.watchesHint')}</p>
          <div style={{ display: 'grid', gap: 10, marginBottom: 16, maxWidth: 560 }}>
            <SearchSelect
              label={t('inspector.agent')}
              value={watchForm.agentId}
              options={agentOptions}
              onChange={(v) => setWatchForm((s) => ({
                ...s,
                agentId: v,
                containerName: '',
                image: '',
              }))}
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
            {containersError ? (
              <p style={{ margin: 0, color: 'var(--danger)', fontSize: 13 }}>{containersError}</p>
            ) : null}
            <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>
              <span>{t('policies.image')}</span>
              <input
                style={input}
                value={watchForm.image}
                onChange={(e) => setWatchForm((s) => ({ ...s, image: e.target.value }))}
                placeholder="registry/app:tag"
              />
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>{t('policies.imageHint')}</span>
            </label>
            <SearchSelect
              label={t('inspector.secret')}
              value={watchForm.secretId}
              options={secretOptions}
              onChange={(v) => setWatchForm((s) => ({ ...s, secretId: v }))}
              emptyLabel={t('common.none')}
              placeholder={t('inspector.searchSecret')}
            />
            <button
              type="button"
              style={{ ...btn, width: 'fit-content' }}
              disabled={!watchForm.containerName || !watchForm.image}
              onClick={() => { void createWatch(); }}
            >
              {t('policies.addWatch')}
            </button>
          </div>
          {watches.length === 0 && <p style={{ color: 'var(--muted)', margin: 0 }}>{t('policies.noWatches')}</p>}
          {watches.map((w) => (
            <div
              key={w.id}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                padding: '8px 0',
                borderBottom: '1px solid var(--border)',
                flexWrap: 'wrap',
              }}
            >
              <strong>{w.containerName}</strong>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>{w.image}</span>
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>{agentName(w.agentId)}</span>
              <button
                type="button"
                style={{ ...btnGhost, marginLeft: 'auto', color: 'var(--danger)', borderColor: 'var(--danger)' }}
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
              </button>
            </div>
          ))}
        </section>
      )}

      {tab === 'policies' && (
        <section style={card}>
          <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('policies.policies')}</h2>
          <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: 13 }}>{t('policies.policiesHint')}</p>

          {watches.length === 0 ? (
            <p style={{ color: 'var(--muted)', margin: '0 0 16px' }}>
              {t('policies.needWatchFirst')}{' '}
              <button
                type="button"
                style={{ ...btnGhost, padding: '4px 8px', fontSize: 13 }}
                onClick={() => setTab('watches')}
              >
                {t('policies.tabWatches')}
              </button>
            </p>
          ) : (
            <div style={{ display: 'grid', gap: 10, marginBottom: 20, maxWidth: 640 }}>
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
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select
                  style={input}
                  value={policyForm.mode}
                  onChange={(e) => setPolicyForm((s) => ({ ...s, mode: e.target.value as 'auto' | 'notify' }))}
                >
                  <option value="notify">{t('policies.modeNotify')}</option>
                  <option value="auto">{t('policies.modeAuto')}</option>
                </select>
                <input
                  style={{ ...input, minWidth: 140 }}
                  placeholder={t('policies.cron')}
                  value={policyForm.cron}
                  onChange={(e) => setPolicyForm((s) => ({ ...s, cron: e.target.value }))}
                  title={t('policies.cronHint')}
                />
                <input
                  style={input}
                  placeholder={t('policies.timezone')}
                  value={policyForm.timezone}
                  onChange={(e) => setPolicyForm((s) => ({ ...s, timezone: e.target.value }))}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  style={{ ...input, width: 110 }}
                  placeholder={t('policies.blackoutStart')}
                  value={policyForm.blackoutStart}
                  onChange={(e) => setPolicyForm((s) => ({ ...s, blackoutStart: e.target.value }))}
                  title="HH:mm"
                />
                <input
                  style={{ ...input, width: 110 }}
                  placeholder={t('policies.blackoutEnd')}
                  value={policyForm.blackoutEnd}
                  onChange={(e) => setPolicyForm((s) => ({ ...s, blackoutEnd: e.target.value }))}
                  title="HH:mm"
                />
                <input
                  style={{ ...input, minWidth: 160, flex: 1 }}
                  placeholder={t('policies.policyNameOptional')}
                  value={policyForm.name}
                  onChange={(e) => setPolicyForm((s) => ({ ...s, name: e.target.value }))}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" style={btn} onClick={() => { void savePolicy(); }}>
                  {editingId ? t('policies.savePolicy') : t('policies.addPolicy')}
                </button>
                {editingId ? (
                  <button type="button" style={btnGhost} onClick={resetPolicyForm}>
                    {t('policies.cancelEdit')}
                  </button>
                ) : null}
              </div>
            </div>
          )}

          {policies.length === 0 && watches.length > 0 && (
            <p style={{ color: 'var(--muted)', margin: 0 }}>{t('policies.noPolicies')}</p>
          )}
          {policies.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: '1px solid var(--border)',
                flexWrap: 'wrap',
                background: editingId === p.id ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : undefined,
                margin: '0 -8px',
                paddingLeft: 8,
                paddingRight: 8,
                borderRadius: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <strong>{p.name}</strong>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {watchLabel(p.watchId)} · {flowName(p.flowId)} · {p.cron} ({p.timezone}) · {p.mode}
                  {p.blackoutStart && p.blackoutEnd ? ` · ${p.blackoutStart}–${p.blackoutEnd}` : ''}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {t('policies.nextRun')}: {p.nextRunAt ? formatDate(p.nextRunAt) : '—'}
                  {p.lastRunAt ? ` · ${t('policies.lastRun')}: ${formatDate(p.lastRunAt)}` : ''}
                </div>
              </div>
              <button type="button" style={btnGhost} onClick={() => startEdit(p)}>
                {t('common.edit')}
              </button>
              <button type="button" style={btnGhost} onClick={() => { void togglePolicy(p); }}>
                {p.enabled ? t('policies.disable') : t('policies.enable')}
              </button>
              <button type="button" style={btnGhost} onClick={() => { void runCheck(p.id); }}>
                {t('policies.checkNow')}
              </button>
              <button
                type="button"
                style={{ ...btnGhost, color: 'var(--danger)', borderColor: 'var(--danger)' }}
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
              </button>
            </div>
          ))}
        </section>
      )}

      {tab === 'io' && (
        <section style={card}>
          <h2 style={{ margin: '0 0 12px', fontSize: 16 }}>{t('policies.tabImportExport')}</h2>
          <div style={{ display: 'grid', gap: 16, maxWidth: 480 }}>
            <div>
              <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>{t('policies.exportHint')}</p>
              <button type="button" style={btnGhost} onClick={() => { void exportBundle(); }}>
                {t('policies.export')}
              </button>
            </div>
            <div>
              <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>{t('policies.importHint')}</p>
              <label style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
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
        </section>
      )}
    </div>
  );
}
