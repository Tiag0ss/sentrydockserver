'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Node } from '@xyflow/react';
import { api } from '@/lib/api';
import {
  CONTEXT_FIELD_VALUES,
  TEMPLATE_TAGS,
  getNodeOutputs,
  inputStyle,
} from './flowConstants';
import { SearchSelect, type SearchOption } from './SearchSelect';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { tt } from '@/lib/i18n/translate';

type Agent = { id: string; name: string; status: string; online: boolean };
type SecretMeta = { id: string; name: string; type: string };
type ContainerRow = {
  id: string;
  name?: string;
  names: string[];
  image: string;
  imageId?: string;
  configImage?: string;
  state: string;
  status: string;
  composeProject?: string | null;
  composeService?: string | null;
};

function isImageIdRef(value: string | undefined | null): boolean {
  if (!value) return false;
  const v = String(value).trim();
  return /^sha256:[a-f0-9]+$/i.test(v) || /^[a-f0-9]{64}$/i.test(v);
}

/** Prefer a pullable name:tag over a raw image id. */
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
  const [templates, setTemplates] = useState<Array<{ id: string; key: string; name: string; body: string }>>([]);
  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [a, s, tpl] = await Promise.all([
          api<Agent[]>('/agents'),
          api<SecretMeta[]>('/secrets'),
          api<Array<{ id: string; key: string; name: string; body: string }>>('/templates'),
        ]);
        setAgents(a);
        setSecrets(s);
        setTemplates(tpl);
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
      hint: `${a.online ? t('agents.online') : tt(t, 'status', a.status)} · ${a.id.slice(0, 8)}…`,
    })),
    [agents, t],
  );

  const secretOptions: SearchOption[] = useMemo(
    () => secrets.map((s) => ({
      value: s.id,
      label: s.name,
      hint: tt(t, 'secretTypes', s.type),
    })),
    [secrets, t],
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
        hint: [compose, preferImageName(c.configImage, c.image), c.state || c.status].filter(Boolean).join(' · '),
      };
    }),
    [containers],
  );

  const imageOptions: SearchOption[] = useMemo(() => {
    const seen = new Set<string>();
    const opts: SearchOption[] = [];
    const add = (value: string, hint?: string) => {
      const v = value.trim();
      if (!v || seen.has(v)) return;
      // Prefer name:tag entries; still allow digests as last-resort custom values.
      seen.add(v);
      opts.push({
        value: v,
        label: v,
        hint: isImageIdRef(v) ? (hint || 'image id') : hint,
      });
    };
    // Keep the value already saved on the node visible even if the agent only returns digests.
    const current = String(selectedNode?.data.image || '');
    if (current) add(current, 'current');
    for (const c of containers) {
      const name = preferImageName(c.configImage, c.image);
      if (name) add(name, c.name || c.names?.[0]);
    }
    // Put human tags first, raw ids last.
    opts.sort((a, b) => Number(isImageIdRef(a.value)) - Number(isImageIdRef(b.value)));
    return opts;
  }, [containers, selectedNode?.data.image]);

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

  function insertTag(key: string, tag: string) {
    const current = String(selectedNode!.data[key] ?? '');
    const token = `{{${tag}}}`;
    const next = current ? `${current}${current.endsWith(' ') || current.endsWith('\n') ? '' : ' '}${token}` : token;
    patch(key, next);
  }

  function templateField(key: string, label: string, opts?: { minHeight?: number; placeholder?: string }) {
    return (
      <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label>
          {label}
          <textarea
            style={{ ...inputStyle, minHeight: opts?.minHeight ?? 72, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}
            placeholder={opts?.placeholder}
            value={String(selectedNode!.data[key] ?? '')}
            onChange={(e) => patch(key, e.target.value)}
          />
        </label>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('inspector.templateTagsHint')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {TEMPLATE_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => insertTag(key, tag)}
              title={`{{${tag}}}`}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--accent)',
                borderRadius: 6,
                padding: '2px 6px',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}
            >
              {`{{${tag}}}`}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
      <div>{t('inspector.type')}: {tt(t, 'nodes', type)}</div>
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
            const currentImage = String(selectedNode.data.image || '');
            const fromContainer = preferImageName(c?.configImage, c?.image);
            // Never replace a good name:tag with a raw sha256 from a broken container Config.Image.
            const nextImage = fromContainer && !isImageIdRef(fromContainer)
              ? fromContainer
              : (currentImage && !isImageIdRef(currentImage) ? currentImage : fromContainer);
            onPatch(id, {
              containerName: v,
              ...(nextImage ? { image: nextImage } : {}),
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

      {type === 'wait_healthy' && (
        <>
          {field('timeoutMs', t('inspector.timeoutMs'), '60000')}
          <label>
            {t('inspector.probeType')}
            <select
              style={inputStyle}
              value={String(selectedNode.data.probeType || 'docker')}
              onChange={(e) => patch('probeType', e.target.value)}
            >
              <option value="docker">{t('inspector.probeDocker')}</option>
              <option value="http">{t('inspector.probeHttp')}</option>
            </select>
          </label>
          {String(selectedNode.data.probeType || 'docker') === 'http' && (
            field('healthUrl', t('inspector.healthUrl'), 'http://127.0.0.1:8080/health')
          )}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={Boolean(selectedNode.data.autoRollback)}
              onChange={(e) => patch('autoRollback', e.target.checked)}
            />
            {t('inspector.autoRollback')}
          </label>
        </>
      )}

      {type === 'condition' && (
        <SearchSelect
          label={t('inspector.contextField')}
          value={String(selectedNode.data.field || 'updateAvailable')}
          options={CONTEXT_FIELD_VALUES.map((value) => ({
            value,
            label: tt(t, 'contextFields', value),
          }))}
          onChange={(v) => patch('field', v || 'updateAvailable')}
          placeholder={t('common.search')}
          emptyLabel={tt(t, 'contextFields', 'updateAvailable')}
        />
      )}

      {type === 'notify' && (
        <>
          {templateField('message', t('inspector.message'), {
            placeholder: t('inspector.notifyPlaceholder'),
          })}
          <label>
            {t('inspector.notifyLevel')}
            <select
              style={inputStyle}
              value={String(selectedNode.data.level || 'auto')}
              onChange={(e) => patch('level', e.target.value === 'auto' ? '' : e.target.value)}
            >
              {(['auto', 'info', 'warn', 'error'] as const).map((level) => (
                <option key={level} value={level}>{tt(t, 'notifyLevel', level)}</option>
              ))}
            </select>
          </label>
        </>
      )}

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
            {t('inspector.templateKey')}
            <select
              style={inputStyle}
              value={String(selectedNode.data.templateKey || '')}
              onChange={(e) => {
                const key = e.target.value;
                const tpl = templates.find((x) => x.key === key);
                onPatch(id, {
                  templateKey: key,
                  ...(tpl?.body ? { templateBody: tpl.body } : {}),
                });
              }}
            >
              <option value="">{t('inspector.selectTemplate')}</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.key}>{tpl.name} ({tpl.key})</option>
              ))}
            </select>
          </label>
          {templateField('templateBody', t('inspector.templateBody'), {
            minHeight: 100,
            placeholder: t('inspector.webhookPlaceholder'),
          })}
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
            {(['wait_all', 'continue_successes', 'await_user'] as const).map((mode) => (
              <option key={mode} value={mode}>{tt(t, 'joinMode', mode)}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
