'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { api } from '@/lib/api';
import {
  TEMPLATE_TAGS,
  getCaseFieldsForPrev,
  getCaseMatchValues,
  getIfFieldsForPrev,
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
  nodes?: Node[];
  edges?: Edge[];
  onPatch: (id: string, patch: Record<string, unknown>) => void;
};

function resolveNodeType(n: Node | null | undefined): string {
  if (!n) return '';
  // React Flow usa type='flowCard'; o tipo lógico está em data.nodeType
  return String(n.data?.nodeType || '');
}

/** Predecessor directo (primeira aresta de entrada). */
function findPreviousNode(
  nodeId: string,
  nodes: Node[],
  edges: Edge[],
): Node | null {
  const incoming = edges.find((e) => e.target === nodeId);
  if (!incoming) return null;
  return nodes.find((n) => n.id === incoming.source) || null;
}

const AGENT_NODES = [
  'pull_image',
  'recreate_container',
  'wait_healthy',
  'rollback',
  'compose_up',
  'compose_down',
];

const CONTAINER_NODES = [
  'check_image_update',
  'recreate_container',
  'wait_healthy',
  'rollback',
];

const CATALOG_IMAGE_NODES = ['pull_image', 'check_image_update'];

type CatalogImage = {
  id: string;
  key: string;
  name: string;
  repository: string;
};
export function NodeInspector({ selectedNode, nodes = [], edges = [], onPatch }: Props) {
  const { t } = useI18n();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [secrets, setSecrets] = useState<SecretMeta[]>([]);
  const [catalogImages, setCatalogImages] = useState<CatalogImage[]>([]);
  const [templates, setTemplates] = useState<Array<{ id: string; key: string; name: string; body: string }>>([]);
  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);

  const previousNode = useMemo(() => {
    if (!selectedNode) return null;
    return findPreviousNode(selectedNode.id, nodes, edges);
  }, [selectedNode, nodes, edges]);

  const previousType = resolveNodeType(previousNode);

  useEffect(() => {
    void (async () => {
      try {
        const [a, s, tpl, imgs] = await Promise.all([
          api<Agent[]>('/agents'),
          api<SecretMeta[]>('/secrets'),
          api<Array<{ id: string; key: string; name: string; body: string }>>('/templates'),
          api<CatalogImage[]>('/docker-images'),
        ]);
        setAgents(a);
        setSecrets(s);
        setTemplates(tpl);
        setCatalogImages(imgs);
      } catch {
        /* keep empty */
      }
    })();
  }, []);

  const agentId = selectedNode ? String(selectedNode.data.agentId || '') : '';
  const catalogImageId = selectedNode ? String(selectedNode.data.imageId || '') : '';

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

  const catalogImageOptions: SearchOption[] = useMemo(
    () => catalogImages.map((img) => ({
      value: img.id,
      label: img.name,
      hint: `${img.key} · ${img.repository}`,
    })),
    [catalogImages],
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
  const outputs = getNodeOutputs(type, selectedNode.data as Record<string, unknown>);
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

  function templatePicker(messageKey: 'message' | 'templateBody', opts?: {
    messageLabel?: string;
    placeholder?: string;
  }) {
    const messageLabel = opts?.messageLabel
      || (messageKey === 'templateBody' ? t('inspector.templateBody') : t('inspector.message'));
    return (
      <>
        <label>
          {t('inspector.templateKey')}
          <select
            style={inputStyle}
            value={String(selectedNode!.data.templateKey || '')}
            onChange={(e) => {
              const key = e.target.value;
              const tpl = templates.find((x) => x.key === key);
              const next: Record<string, unknown> = { templateKey: key };
              if (tpl?.body) {
                const trimmed = tpl.body.trim();
                let human = tpl.body;
                if (trimmed.startsWith('{')) {
                  try {
                    const parsed = JSON.parse(trimmed) as { text?: string; message?: string };
                    human = parsed.text || parsed.message || tpl.body;
                  } catch {
                    /* keep */
                  }
                }
                if (messageKey === 'message') next.message = human;
                else next.templateBody = tpl.body;
              }
              onPatch(id, next);
            }}
          >
            <option value="">{t('inspector.selectTemplate')}</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.key}>{tpl.name} ({tpl.key})</option>
            ))}
          </select>
        </label>
        {templateField(messageKey, messageLabel, {
          minHeight: messageKey === 'templateBody' ? 100 : 72,
          placeholder: opts?.placeholder,
        })}
      </>
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

      {CONTAINER_NODES.includes(type) && !CATALOG_IMAGE_NODES.includes(type) && (
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

      {CATALOG_IMAGE_NODES.includes(type) && (
        <SearchSelect
          label={t('inspector.catalogImage')}
          value={catalogImageId}
          options={catalogImageOptions}
          onChange={(v) => patch('imageId', v)}
          placeholder={t('inspector.searchCatalogImage')}
          emptyLabel={t('inspector.selectCatalogImage')}
        />
      )}

      {type === 'recreate_container' && (
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

      {type === 'check_image_update' && (
        <>
          <label>
            {t('inspector.agentScope')}
            <select
              style={inputStyle}
              value={String(selectedNode.data.agentScope || 'all')}
              onChange={(e) => patch('agentScope', e.target.value)}
            >
              <option value="all">{t('inspector.scopeAll')}</option>
              <option value="labels">{t('inspector.scopeLabels')}</option>
              <option value="single">{t('inspector.scopeSingle')}</option>
            </select>
          </label>
          {String(selectedNode.data.agentScope || '') === 'labels' && (
            field('agentLabels', t('inspector.agentLabels'), 'prod, eu-west')
          )}
          <SearchSelect
            label={String(selectedNode.data.agentScope) === 'single'
              ? t('inspector.agent')
              : t('inspector.browseAgent')}
            value={agentId}
            options={agentOptions}
            onChange={(v) => onPatch(id, { agentId: v, containerName: '' })}
            placeholder={t('inspector.searchAgent')}
            emptyLabel={t('inspector.selectAgent')}
          />
        </>
      )}

      {(type === 'if' || type === 'condition') && (() => {
        const ifFields = getIfFieldsForPrev(previousType || null);
        const saved = String(selectedNode.data.field || '');
        const currentField = ifFields.includes(saved) ? saved : (ifFields[0] || '');
        const fieldOptions: SearchOption[] = ifFields.map((value) => ({
          value,
          label: tt(t, 'contextFields', value),
        }));
        return (
          <>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
              {previousNode
                ? t('inspector.basedOnPrevious', { type: tt(t, 'nodes', previousType || 'notify') })
                : t('inspector.noPreviousNode')}
            </div>
            {ifFields.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('inspector.noBoolFields')}</div>
            ) : (
              <SearchSelect
                label={t('inspector.contextField')}
                value={currentField}
                options={fieldOptions}
                onChange={(v) => {
                  if (v && ifFields.includes(v)) patch('field', v);
                }}
                placeholder={t('common.search')}
                emptyLabel={tt(t, 'contextFields', ifFields[0])}
              />
            )}
          </>
        );
      })()}

      {type === 'case' && (() => {
        const caseFields = getCaseFieldsForPrev(previousType || null);
        const defaultField = caseFields[0]?.field || '';
        const savedField = String(selectedNode.data.field || '');
        const currentField = caseFields.some((f) => f.field === savedField)
          ? savedField
          : defaultField;
        const fieldOptions: SearchOption[] = caseFields.map((f) => ({
          value: f.field,
          label: tt(t, 'contextFields', f.field),
        }));
        const matchValues = currentField
          ? getCaseMatchValues(previousType || null, currentField)
          : [];
        const cases = Array.isArray(selectedNode.data.cases)
          ? (selectedNode.data.cases as Array<{ id: string; match: string }>)
          : [];
        const usedMatches = new Set(cases.map((c) => c.match).filter(Boolean));
        const nextUnused = matchValues.find((v) => !usedMatches.has(v)) || '';

        const matchOptions = (): SearchOption[] =>
          matchValues.map((value) => ({
            value,
            label: portLabel(value),
          }));

        return (
          <>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
              {previousNode
                ? t('inspector.basedOnPrevious', { type: tt(t, 'nodes', previousType || 'notify') })
                : t('inspector.noPreviousNode')}
            </div>
            {caseFields.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('inspector.noEnumFields')}</div>
            ) : (
              <>
                {caseFields.length > 1 && (
                  <SearchSelect
                    label={t('inspector.contextField')}
                    value={currentField}
                    options={fieldOptions}
                    onChange={(v) => {
                      const nextField = caseFields.some((f) => f.field === v) ? v : defaultField;
                      const nextMatches = getCaseMatchValues(previousType || null, nextField);
                      onPatch(id, {
                        field: nextField,
                        cases: nextMatches.slice(0, Math.max(1, nextMatches.length - (nextMatches.includes('error') ? 1 : 0))).map((m) => ({
                          id: m,
                          match: m,
                        })),
                      });
                    }}
                    placeholder={t('common.search')}
                    emptyLabel={tt(t, 'contextFields', defaultField)}
                  />
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontWeight: 600 }}>{t('inspector.caseWhens')}</div>
                  {cases.map((row, idx) => (
                    <div key={row.id || idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <SearchSelect
                          label=""
                          value={matchValues.includes(row.match) ? row.match : ''}
                          options={matchOptions().filter(
                            (o) => o.value === row.match || !usedMatches.has(o.value),
                          )}
                          onChange={(v) => {
                            if (!v || !matchValues.includes(v)) return;
                            const next = [...cases];
                            next[idx] = { id: v, match: v };
                            patch('cases', next);
                          }}
                          placeholder={t('inspector.caseMatch')}
                          emptyLabel={t('inspector.caseMatch')}
                        />
                      </div>
                      <button
                        type="button"
                        style={{ ...inputStyle, marginTop: 0, width: 'auto', cursor: 'pointer' }}
                        onClick={() => {
                          const next = [...cases];
                          next.splice(idx, 1);
                          patch('cases', next);
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    style={{ ...inputStyle, marginTop: 0, cursor: 'pointer' }}
                    disabled={!nextUnused}
                    onClick={() => {
                      if (!nextUnused) return;
                      patch('cases', [...cases, { id: nextUnused, match: nextUnused }]);
                    }}
                  >
                    {t('inspector.addCase')}
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('inspector.caseElseHint')}</div>
                </div>
              </>
            )}
          </>
        );
      })()}

      {type === 'split' && (
        <label>
          {t('inspector.targetsSource')}
          <select
            style={inputStyle}
            value={String(selectedNode.data.targetsSource || 'context')}
            onChange={(e) => patch('targetsSource', e.target.value)}
          >
            <option value="context">{t('inspector.targetsFromContext')}</option>
            <option value="manual">{t('inspector.targetsManual')}</option>
          </select>
        </label>
      )}

      {type === 'notify' && (
        <>
          {templatePicker('message', { placeholder: t('inspector.notifyPlaceholder') })}
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

      {type === 'wait_approval' && (
        <>
          {templatePicker('message', {
            messageLabel: t('inspector.approvalMessage'),
            placeholder: t('inspector.approvalPlaceholder'),
          })}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={Boolean(selectedNode.data.allowTargetOverride)}
              onChange={(e) => patch('allowTargetOverride', e.target.checked)}
            />
            {t('inspector.allowTargetOverride')}
          </label>
        </>
      )}

      {type === 'recreate_container' && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={Boolean(selectedNode.data.advancePinOnSuccess)}
            onChange={(e) => patch('advancePinOnSuccess', e.target.checked)}
          />
          {t('inspector.advancePinOnSuccess')}
        </label>
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
          {templatePicker('templateBody', { placeholder: t('inspector.webhookPlaceholder') })}
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
