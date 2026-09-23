'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Node } from '@xyflow/react';
import { api } from '@/lib/api';
import {
  CONTEXT_FIELDS,
  getNodeOutputs,
  inputStyle,
} from './flowConstants';
import { SearchSelect, type SearchOption } from './SearchSelect';
import { useI18n } from '@/lib/i18n/I18nProvider';

type Agent = { id: string; name: string; status: string; online: boolean };
type SecretMeta = { id: string; name: string; type: string };
type ContainerRow = {
  id: string;
  name?: string;
  names: string[];
  image: string;
  state: string;
  status: string;
  composeProject?: string | null;
  composeService?: string | null;
};

type Props = {
  selectedNode: Node | null;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
};

const AGENT_NODES = [
  'pull_image',
  'check_image_update',
  'recreate_container',
  'wait_healthy',
  'rollback',
  'compose_up',
  'compose_down',
];

const CONTAINER_NODES = [
  'pull_image',
  'check_image_update',
  'recreate_container',
  'wait_healthy',
  'rollback',
];

export function NodeInspector({ selectedNode, onPatch }: Props) {
  const { t } = useI18n();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [secrets, setSecrets] = useState<SecretMeta[]>([]);
  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [a, s] = await Promise.all([
          api<Agent[]>('/agents'),
          api<SecretMeta[]>('/secrets'),
        ]);
        setAgents(a);
        setSecrets(s);
      } catch {
        /* keep empty */
      }
    })();
  }, []);

  const agentId = selectedNode ? String(selectedNode.data.agentId || '') : '';

  useEffect(() => {
    if (!agentId) {
      setContainers([]);
      return;
    }
    let cancelled = false;
    setLoadingContainers(true);
    void (async () => {
      try {
        const list = await api<ContainerRow[]>(`/agents/${agentId}/containers`);
        if (!cancelled) setContainers(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setContainers([]);
      } finally {
        if (!cancelled) setLoadingContainers(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agentId]);

  const agentOptions: SearchOption[] = useMemo(
    () => agents.map((a) => ({
      value: a.id,
      label: a.name,
      hint: `${a.online ? 'online' : a.status} · ${a.id.slice(0, 8)}…`,
    })),
    [agents],
  );

  const secretOptions: SearchOption[] = useMemo(
    () => secrets.map((s) => ({
      value: s.id,
      label: s.name,
      hint: s.type,
    })),
    [secrets],
  );

  const containerOptions: SearchOption[] = useMemo(
    () => containers.map((c) => {
      const name = c.name || (c.names?.[0] || c.id).replace(/^\//, '');
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

  const imageOptions: SearchOption[] = useMemo(() => {
    const seen = new Set<string>();
    const opts: SearchOption[] = [];
    for (const c of containers) {
      if (!c.image || seen.has(c.image)) continue;
      seen.add(c.image);
      opts.push({ value: c.image, label: c.image });
    }
    return opts;
  }, [containers]);

  if (!selectedNode) {
    return <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('flows.selectNode')}</div>;
  }

  const type = String(selectedNode.data.nodeType);
  const outputs = getNodeOutputs(type);
  const id = selectedNode.id;
  const patch = (key: string, value: unknown) => onPatch(id, { [key]: value });
  const hintKey = `nodeHints.${type}`;
  const hint = t(hintKey) === hintKey ? t('nodeHints.default') : t(hintKey);
  const portLabel = (portId: string) => {
    const key = `ports.${portId}`;
    const v = t(key);
    return v === key ? portId : v;
  };

  function field(key: string, label: string, placeholder?: string) {
    return (
      <label key={key}>
        {label}
        <input
          style={inputStyle}
          placeholder={placeholder}
          value={String(selectedNode!.data[key] ?? '')}
          onChange={(e) => patch(key, e.target.value)}
        />
      </label>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
      <div>{t('inspector.type')}: {type}</div>
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12, lineHeight: 1.4 }}>
        {hint}
      </p>

      <div style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 8,
        fontSize: 12,
      }}>
        <div style={{ color: 'var(--muted)', marginBottom: 4 }}>{t('flows.outputs')}</div>
        {outputs.map((o) => (
          <div key={o.id} style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
            <code style={{ color: 'var(--accent)' }}>{o.id}</code>
            <span>{portLabel(o.id)}</span>
          </div>
        ))}
      </div>

      <label>
        {t('flows.retries')}
        <input
          type="number"
          min={0}
          value={Number(selectedNode.data.retries || 0)}
          onChange={(e) => patch('retries', Number(e.target.value))}
          style={inputStyle}
        />
      </label>

      {AGENT_NODES.includes(type) && (
        <SearchSelect
          label={t('inspector.agent')}
          value={agentId}
          options={agentOptions}
          onChange={(v) => onPatch(id, {
            agentId: v,
            ...(CONTAINER_NODES.includes(type) ? { containerName: '' } : {}),
          })}
          placeholder={t('inspector.searchAgent')}
          emptyLabel={t('inspector.selectAgent')}
        />
      )}

      {CONTAINER_NODES.includes(type) && (
        <SearchSelect
          label={t('inspector.container')}
          value={String(selectedNode.data.containerName || '')}
          options={containerOptions}
          onChange={(v) => {
            const c = containers.find((x) =>
              x.name === v
              || (x.names?.[0] || '').replace(/^\//, '') === v
              || x.id === v
              || x.id.startsWith(v),
            );
            onPatch(id, {
              containerName: v,
              ...(c?.image ? { image: c.image } : {}),
            });
          }}
          placeholder={t('inspector.searchContainer')}
          emptyLabel={agentId ? t('inspector.selectContainer') : t('inspector.pickAgentFirst')}
          disabled={!agentId}
          loading={loadingContainers}
        />
      )}

      {CONTAINER_NODES.includes(type) && (
        <SearchSelect
          label={t('inspector.image')}
          value={String(selectedNode.data.image || '')}
          options={imageOptions}
          onChange={(v) => patch('image', v)}
          placeholder={t('inspector.searchImage')}
          emptyLabel={t('inspector.selectImage')}
          allowCustom
        />
      )}

      {['pull_image', 'check_image_update'].includes(type) && (
        <SearchSelect
          label={t('inspector.secret')}
          value={String(selectedNode.data.secretId || '')}
          options={secretOptions}
          onChange={(v) => patch('secretId', v)}
          placeholder={t('inspector.searchSecret')}
          emptyLabel={t('common.none')}
        />
      )}

      {['compose_up', 'compose_down'].includes(type) && field('projectPath', t('inspector.projectPath'), '/path/to/compose')}

      {type === 'wait_healthy' && field('timeoutMs', t('inspector.timeoutMs'), '60000')}

      {type === 'condition' && (
        <SearchSelect
          label={t('inspector.contextField')}
          value={String(selectedNode.data.field || 'updateAvailable')}
          options={CONTEXT_FIELDS}
          onChange={(v) => patch('field', v || 'updateAvailable')}
          placeholder={t('common.search')}
          emptyLabel="updateAvailable"
        />
      )}

      {type === 'notify' && field('message', t('inspector.message'))}

      {type === 'webhook' && (
        <>
          {field('url', t('inspector.url'))}
          <label>
            {t('inspector.method')}
            <select
              style={inputStyle}
              value={String(selectedNode.data.method || 'POST')}
              onChange={(e) => patch('method', e.target.value)}
            >
              {['POST', 'PUT', 'PATCH', 'GET'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            {t('inspector.templateBody')}
            <textarea
              style={{ ...inputStyle, minHeight: 80 }}
              value={String(selectedNode.data.templateBody || '')}
              onChange={(e) => patch('templateBody', e.target.value)}
            />
          </label>
        </>
      )}

      {type === 'join' && (
        <label>
          {t('inspector.joinMode')}
          <select
            style={inputStyle}
            value={String(selectedNode.data.mode || 'wait_all')}
            onChange={(e) => patch('mode', e.target.value)}
          >
            <option value="wait_all">wait_all</option>
            <option value="continue_successes">continue_successes</option>
            <option value="await_user">await_user</option>
          </select>
        </label>
      )}
    </div>
  );
}
