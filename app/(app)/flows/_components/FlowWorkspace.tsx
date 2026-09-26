'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from '@/lib/api';
import { FlowCard } from './FlowCard';
import { NodeInspector } from './NodeInspector';
import { FlowContextMenu, type ContextMenuState, type ContextTarget } from './FlowContextMenu';
import { NODE_TYPES_LIST, getNodeOutputs, normalizeHandle, branchesFromTargets, getSplitBranches, btnStyle, btnSecondaryStyle, inputStyle } from './flowConstants';
import type { SplitBranch } from './flowConstants';
import type { FlowSummary } from './FlowsList';
import { useI18n } from '@/lib/i18n/I18nProvider';
import { useIsMobile } from '@/hooks/useIsMobile';

/** Normaliza para HH:mm; rejeita valores inválidos. */
function normalizeBlackoutTime(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  const m = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const defaultEdgeOptions = {
  type: 'default' as const,
  animated: false,
  style: { stroke: '#5a7aa8' },
};

const nodeTypes = { flowCard: FlowCard };

function portLabelKey(id: string) {
  return `ports.${id}`;
}

/** Encontra o check_image_update a montante do split (BFS inverso). */
function findUpstreamCheckTargets(
  splitId: string,
  nodes: Node[],
  edges: Edge[],
): unknown[] | null {
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    const list = incoming.get(e.target) || [];
    list.push(e.source);
    incoming.set(e.target, list);
  }
  const q = [splitId];
  const seen = new Set<string>();
  while (q.length) {
    const id = q.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = nodes.find((x) => x.id === id);
    const type = String(n?.data?.nodeType || n?.type || '');
    if (type === 'check_image_update' && n) {
      return Array.isArray(n.data.targets) ? (n.data.targets as unknown[]) : [];
    }
    for (const src of incoming.get(id) || []) q.push(src);
  }
  return null;
}

function branchesEqual(a: SplitBranch[], b: SplitBranch[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.id === b[i]?.id && x.label === b[i]?.label);
}

/** Redistribui arestas `out` do split para handles por contentor quando faz sentido. */
function redistributeSplitEdges(
  splitId: string,
  branches: SplitBranch[],
  edges: Edge[],
): Edge[] {
  if (!branches.length) return edges;
  const outs = edges.filter((e) => e.source === splitId);
  if (!outs.length) return edges;

  const isGeneric = (e: Edge) => {
    const h = String(e.sourceHandle || 'out');
    return h === 'out' || h === 'ok' || h === 'success';
  };
  const generic = outs.filter(isGeneric);
  const specific = outs.filter((e) => !isGeneric(e));
  const rest = edges.filter((e) => e.source !== splitId);

  // Já há handles por contentor: remover leftovers `out` (senão o motor podia seguir os 3 caminhos)
  if (specific.length > 0) {
    const specificIds = new Set(specific.map((e) => String(e.sourceHandle)));
    const branchIds = new Set(branches.map((b) => b.id));
    // Manter só específicas que ainda correspondem a um branch
    const kept = specific.filter((e) => branchIds.has(String(e.sourceHandle)));
    // Se faltam branches sem aresta e ainda há genéricas, atribuir
    const missing = branches.filter((b) => !specificIds.has(b.id));
    if (missing.length && generic.length === 1) {
      const g = generic[0];
      return [
        ...rest,
        ...kept,
        ...missing.map((b) => ({
          ...g,
          id: `e-${splitId}-${g.target}-${b.id}`,
          sourceHandle: b.id,
          label: b.label,
        })),
      ];
    }
    return [...rest, ...kept];
  }

  // Só genéricas → redistribuir
  if (generic.length === 1) {
    const e = generic[0];
    return [
      ...rest,
      ...branches.map((b) => ({
        ...e,
        id: `e-${splitId}-${e.target}-${b.id}`,
        sourceHandle: b.id,
        label: b.label,
      })),
    ];
  }
  if (generic.length === branches.length) {
    return [
      ...rest,
      ...generic.map((e, i) => ({
        ...e,
        id: e.id || `e-${splitId}-${e.target}-${branches[i].id}`,
        sourceHandle: branches[i].id,
        label: branches[i].label,
      })),
    ];
  }
  return edges;
}

function toFlowNodes(graphNodes: FlowSummary['graph']['nodes'], nodeLabel: (type: string) => string): Node[] {
  return (graphNodes || []).map((raw) => {
    const n = raw as Node & { type?: string; data?: Record<string, unknown> };
    const nodeType = String(n.type || n.data?.nodeType || 'notify');
    return {
      ...n,
      type: 'flowCard',
      deletable: true,
      data: {
        ...n.data,
        label: nodeLabel(nodeType),
        nodeType,
      },
    };
  });
}

function toFlowEdges(
  graphEdges: FlowSummary['graph']['edges'],
  graphNodes: FlowSummary['graph']['nodes'],
  edgeLabel: (portId: string, sourceData?: Record<string, unknown> | null) => string,
): Edge[] {
  const nodeById = new Map(
    (graphNodes || []).map((raw) => {
      const n = raw as { id: string; type?: string; data?: Record<string, unknown> };
      return [n.id, n] as const;
    }),
  );
  return ((graphEdges || []) as Edge[])
    .filter((e) => e.source !== e.target)
    .map((e) => {
    const src = nodeById.get(e.source);
    const type = String(src?.type || src?.data?.nodeType || '');
    const outputs = getNodeOutputs(type, src?.data || null);
    const sourceHandle = normalizeHandle(type, e.sourceHandle, src?.data || null);
    const port = outputs.find((o) => o.id === sourceHandle);
    return {
      ...e,
      sourceHandle,
      targetHandle: e.targetHandle || 'in',
      deletable: true,
      label: e.label
        ?? (outputs.length > 1
          ? (port?.label || edgeLabel(sourceHandle, src?.data || null))
          : undefined),
      ...defaultEdgeOptions,
    };
  });
}

type CanvasProps = {
  initial: FlowSummary | null;
  onBack: () => void;
  onSaved: (flow: FlowSummary) => void;
};

function FlowCanvas({ initial, onBack, onSaved }: CanvasProps) {
  const { t } = useI18n();
  const nodeLabel = useCallback((type: string) => {
    const key = `nodes.${type}`;
    const translated = t(key);
    return translated === key ? type : translated;
  }, [t]);
  const edgePortLabel = useCallback((portId: string, sourceData?: Record<string, unknown> | null) => {
    if (sourceData) {
      const br = getSplitBranches(sourceData).find((b) => b.id === portId);
      if (br) return br.label;
    }
    const key = portLabelKey(portId);
    const translated = t(key);
    return translated === key ? portId : translated;
  }, [t]);

  const [flowId, setFlowId] = useState<string | null>(initial?.id ?? null);
  const [name, setName] = useState(initial?.name ?? t('flows.newName'));
  const [scheduleEnabled, setScheduleEnabled] = useState(Boolean(initial?.scheduleEnabled));
  const [cron, setCron] = useState(initial?.cron || '0 */6 * * *');
  const [timezone, setTimezone] = useState(initial?.timezone || 'Europe/Lisbon');
  const [blackoutStart, setBlackoutStart] = useState(normalizeBlackoutTime(initial?.blackoutStart || ''));
  const [blackoutEnd, setBlackoutEnd] = useState(normalizeBlackoutTime(initial?.blackoutEnd || ''));
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    initial
      ? toFlowNodes(initial.graph.nodes, nodeLabel)
      : [{
        id: `check_image_update-${Date.now()}`,
        type: 'flowCard',
        position: { x: 160, y: 140 },
        data: {
          label: nodeLabel('check_image_update'),
          nodeType: 'check_image_update',
          retries: 0,
          targets: [],
        },
        deletable: true,
      }],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initial ? toFlowEdges(initial.graph.edges, initial.graph.nodes, edgePortLabel) : [],
  );
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [msg, setMsg] = useState('');
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [mobilePanel, setMobilePanel] = useState<'palette' | 'inspector' | null>(null);
  const isMobile = useIsMobile();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  useEffect(() => {
    if (!initial) return;
    setFlowId(initial.id);
    setName(initial.name);
    setScheduleEnabled(Boolean(initial.scheduleEnabled));
    setCron(initial.cron || '0 */6 * * *');
    setTimezone(initial.timezone || 'Europe/Lisbon');
    setBlackoutStart(normalizeBlackoutTime(initial.blackoutStart || ''));
    setBlackoutEnd(normalizeBlackoutTime(initial.blackoutEnd || ''));
    setNodes(toFlowNodes(initial.graph.nodes, nodeLabel));
    setEdges(toFlowEdges(initial.graph.edges, initial.graph.nodes, edgePortLabel));
  }, [initial, setNodes, setEdges, nodeLabel, edgePortLabel]);

  // Sync: split (contexto) → 1 saída por contentor do check a montante; limpar leftovers `out`
  useEffect(() => {
    let nodesChanged = false;
    let edgesChanged = false;
    let nextNodes = nodes;
    let nextEdges = edges;

    for (const n of nodes) {
      const type = String(n.data.nodeType || '');
      if (type !== 'split') continue;
      const src = String(n.data.targetsSource || 'context');
      if (src !== 'context') continue;
      const checkTargets = findUpstreamCheckTargets(n.id, nodes, edges);
      if (checkTargets == null) continue;
      const branches = branchesFromTargets(checkTargets);
      const current = getSplitBranches(n.data as Record<string, unknown>);
      if (!branchesEqual(current, branches)) {
        nodesChanged = true;
        nextNodes = nextNodes.map((x) => (
          x.id === n.id
            ? { ...x, data: { ...x.data, branches } }
            : x
        ));
      }
      const effectiveBranches = branches.length ? branches : current;
      if (!effectiveBranches.length) continue;
      const cleaned = redistributeSplitEdges(n.id, effectiveBranches, nextEdges);
      if (cleaned.length !== nextEdges.length
        || cleaned.some((e, i) => e.id !== nextEdges[i]?.id || e.sourceHandle !== nextEdges[i]?.sourceHandle)) {
        edgesChanged = true;
        nextEdges = cleaned;
      }
    }

    if (nodesChanged) setNodes(nextNodes);
    if (nodesChanged || edgesChanged) {
      const byId = new Map(nextNodes.map((n) => [n.id, n]));
      setEdges(nextEdges.map((e) => {
        const srcNode = byId.get(e.source);
        const nodeType = String(srcNode?.data?.nodeType || '');
        const outputs = getNodeOutputs(nodeType, (srcNode?.data || null) as Record<string, unknown> | null);
        const sourceHandle = normalizeHandle(
          nodeType,
          e.sourceHandle,
          (srcNode?.data || null) as Record<string, unknown> | null,
        );
        const port = outputs.find((o) => o.id === sourceHandle);
        return {
          ...e,
          sourceHandle,
          label: outputs.length > 1
            ? (port?.label || edgePortLabel(sourceHandle, srcNode?.data as Record<string, unknown>))
            : e.label,
        };
      }));
    }
  }, [nodes, edges, setNodes, setEdges, edgePortLabel]);

  const isValidConnection = useCallback((c: Connection | Edge) => {
    if (!c.source || !c.target) return false;
    return c.source !== c.target;
  }, []);

  function flowCenter() {
    const el = wrapperRef.current;
    if (!el) return { x: 120, y: 120 };
    const rect = el.getBoundingClientRect();
    return screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const sourceNode = nodes.find((n) => n.id === c.source);
      const nodeType = String(sourceNode?.data.nodeType || '');
      const data = (sourceNode?.data || {}) as Record<string, unknown>;
      const outputs = getNodeOutputs(nodeType, data);
      const handleId = normalizeHandle(
        nodeType,
        c.sourceHandle || outputs[0]?.id || 'out',
        data,
      );
      const port = outputs.find((o) => o.id === handleId);
      const portLabel = outputs.length > 1
        ? (port?.label || edgePortLabel(handleId, data))
        : undefined;
      setEdges((eds) => addEdge({
        ...c,
        sourceHandle: handleId,
        targetHandle: c.targetHandle || 'in',
        deletable: true,
        label: portLabel,
        ...defaultEdgeOptions,
      }, eds));
    },
    [setEdges, nodes, edgePortLabel],
  );
  const types = useMemo(() => nodeTypes, []);

  function patchNode(id: string, patch: Record<string, unknown>) {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    setSelectedNode((sn) => (sn && sn.id === id ? { ...sn, data: { ...sn.data, ...patch } } : sn));
  }

  function addNode(type: string, position?: { x: number; y: number }) {
    const id = `${type}-${Date.now()}`;
    const center = position ?? flowCenter();
    setNodes((ns) => {
      let { x, y } = center;
      // Desloca ligeiramente se já houver node no mesmo sítio
      const clash = ns.some((n) => Math.abs(n.position.x - x) < 48 && Math.abs(n.position.y - y) < 48);
      if (clash) {
        const offset = ns.length % 6;
        x += 48 + offset * 28;
        y += 32 + offset * 16;
      }
      return [...ns, {
        id,
        type: 'flowCard',
        position: { x, y },
        data: {
          label: nodeLabel(type),
          nodeType: type,
          retries: 0,
          ...(type === 'if' ? { field: 'lastResult' } : {}),
          ...(type === 'case' ? {
            field: 'lastOutcome',
            cases: [
              { id: 'update', match: 'update' },
              { id: 'no_update', match: 'no_update' },
            ],
          } : {}),
          ...(type === 'check_image_update' ? { targets: [] } : {}),
          ...(type === 'split' ? { targetsSource: 'context' } : {}),
          ...(type === 'run_flow' ? { wait: true } : {}),
        },
        deletable: true,
      }];
    });
  }

  const openMenu = useCallback((e: React.MouseEvent, target: ContextTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, target });
  }, []);

  const onNodeContextMenu: NodeMouseHandler = useCallback((e, node) => {
    openMenu(e, { kind: 'node', id: node.id });
    setSelectedNode(node);
  }, [openMenu]);

  const onEdgeContextMenu: EdgeMouseHandler = useCallback((e, edge) => {
    openMenu(e, { kind: 'edge', id: edge.id });
  }, [openMenu]);

  const onPaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault();
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setMenu({
      x: e.clientX,
      y: e.clientY,
      target: { kind: 'pane', flowX: pos.x, flowY: pos.y },
    });
  }, [screenToFlowPosition]);

  function handleContextAction(actionId: string, target: ContextTarget) {
    if (actionId.startsWith('add:') && target.kind === 'pane') {
      const type = actionId.slice(4);
      addNode(type, { x: target.flowX, y: target.flowY });
      return;
    }
    if (actionId === 'fit-view') {
      void fitView({ padding: 0.2 });
      return;
    }
    if (actionId === 'delete-node' && target.kind === 'node') {
      setNodes((ns) => ns.filter((n) => n.id !== target.id));
      setEdges((eds) => eds.filter((e) => e.source !== target.id && e.target !== target.id));
      setSelectedNode((sn) => (sn?.id === target.id ? null : sn));
      return;
    }
    if (actionId === 'duplicate' && target.kind === 'node') {
      const src = nodes.find((n) => n.id === target.id);
      if (!src) return;
      const id = `${String(src.data.nodeType)}-${Date.now()}`;
      setNodes((ns) => [...ns, {
        ...src,
        id,
        position: { x: src.position.x + 40, y: src.position.y + 40 },
        selected: false,
        data: { ...src.data },
      }]);
      return;
    }
    if (actionId === 'inspect' && target.kind === 'node') {
      const n = nodes.find((x) => x.id === target.id) || null;
      setSelectedNode(n);
      return;
    }
    if (actionId === 'delete-edge' && target.kind === 'edge') {
      setEdges((eds) => eds.filter((e) => e.id !== target.id));
    }
  }

  function buildGraph() {
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: String(n.data.nodeType),
        position: n.position,
        data: { ...n.data, retries: Number(n.data.retries || 0) },
      })),
      edges,
    };
  }

  async function save() {
    const graph = buildGraph();
    const payload = {
      name,
      graph,
      scheduleEnabled,
      cron: scheduleEnabled ? cron : null,
      timezone,
      blackoutStart: blackoutStart || null,
      blackoutEnd: blackoutEnd || null,
    };
    if (flowId) {
      await api(`/flows/${flowId}`, { method: 'PUT', body: JSON.stringify(payload) });
      onSaved({
        id: flowId,
        name,
        description: initial?.description ?? null,
        updatedAt: new Date().toISOString(),
        graph,
        scheduleEnabled,
        cron: scheduleEnabled ? cron : null,
        timezone,
        blackoutStart: blackoutStart || null,
        blackoutEnd: blackoutEnd || null,
      });
    } else {
      const res = await api<{ id: string }>('/flows', { method: 'POST', body: JSON.stringify(payload) });
      setFlowId(res.id);
      onSaved({
        id: res.id,
        name,
        description: null,
        updatedAt: new Date().toISOString(),
        graph,
        scheduleEnabled,
        cron: scheduleEnabled ? cron : null,
        timezone,
        blackoutStart: blackoutStart || null,
        blackoutEnd: blackoutEnd || null,
      });
    }
    setMsg(t('flows.saved'));
  }

  async function run(dryRun = false) {
    if (!flowId) { setMsg(t('flows.saveFirst')); return; }
    const res = await api<{ runId: string }>(`/flows/${flowId}/run`, {
      method: 'POST',
      body: JSON.stringify({ dryRun }),
    });
    setMsg(t('runs.runStarted', {
      id: res.runId.slice(0, 8),
      dry: dryRun ? t('runs.runStartedDry') : '',
    }));
  }

  async function exportFlow() {
    if (!flowId) return;
    const data = await api(`/flows/${flowId}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || 'flow'}.json`;
    a.click();
  }

  async function importFlow(file: File) {
    const data = JSON.parse(await file.text());
    const res = await api<{ id: string }>('/flows/import', { method: 'POST', body: JSON.stringify(data) });
    setFlowId(res.id);
    setName(String(data.name || t('flows.imported')));
    if (data.graph) {
      setNodes(toFlowNodes(data.graph.nodes || [], nodeLabel));
      setEdges(toFlowEdges(data.graph.edges || [], data.graph.nodes || [], edgePortLabel));
    }
    setMsg(t('flows.imported'));
  }

  const palette = (
    <div style={{ overflow: 'auto', border: '1px solid var(--sd-border)', borderRadius: 10, padding: 8, background: 'var(--sd-panel)', height: '100%' }}>
      <div style={{ fontSize: 12, color: 'var(--sd-muted)', marginBottom: 8 }}>{t('flows.addCard')}</div>
      {NODE_TYPES_LIST.map((n) => (
        <button
          key={n.type}
          type="button"
          onClick={() => {
            addNode(n.type);
            if (isMobile) setMobilePanel(null);
          }}
          style={{
            display: 'block', width: '100%', textAlign: 'left', background: 'transparent', color: 'var(--sd-text)',
            border: '1px solid var(--sd-border)', padding: 8, borderRadius: 6, cursor: 'pointer', marginBottom: 4, fontSize: 12,
            minHeight: 40,
          }}
        >
          {nodeLabel(n.type)}
        </button>
      ))}
    </div>
  );

  const inspector = (
    <div style={{ border: '1px solid var(--sd-border)', borderRadius: 10, padding: 12, background: 'var(--sd-panel)', height: '100%', overflow: 'auto' }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('flows.properties')}</div>
      <NodeInspector
        selectedNode={
          selectedNode
            ? (nodes.find((n) => n.id === selectedNode.id) || selectedNode)
            : null
        }
        nodes={nodes}
        edges={edges}
        onPatch={patchNode}
      />
      {selectedNode && (
        <button
          type="button"
          onClick={() => handleContextAction('delete-node', { kind: 'node', id: selectedNode.id })}
          style={{ ...btnSecondaryStyle, marginTop: 12, color: 'var(--sd-danger)', borderColor: 'var(--sd-danger)', width: '100%' }}
        >
          {t('flows.removeNode')}
        </button>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: 'calc(100dvh - 120px)', minHeight: 420 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={onBack} style={btnSecondaryStyle}>{t('flows.back')}</button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ ...inputStyle, width: isMobile ? '100%' : 220, marginTop: 0, flex: isMobile ? '1 1 100%' : undefined }}
        />
        <button type="button" onClick={() => void save()} style={btnStyle}>{t('common.save')}</button>
        <button type="button" onClick={() => void run(false)} style={btnStyle}>{t('flows.run')}</button>
        <button type="button" onClick={() => void run(true)} style={btnSecondaryStyle}>{t('flows.dryRun')}</button>
        <button type="button" onClick={() => void exportFlow()} style={btnSecondaryStyle}>{t('flows.export')}</button>
        <label style={{ ...btnSecondaryStyle, display: 'inline-block', cursor: 'pointer' }}>
          {t('flows.import')}
          <input type="file" accept="application/json" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFlow(f);
          }} />
        </label>
        {isMobile ? (
          <>
            <button type="button" style={btnSecondaryStyle} onClick={() => setMobilePanel('palette')}>{t('flows.addCard')}</button>
            <button type="button" style={btnSecondaryStyle} onClick={() => setMobilePanel('inspector')}>{t('flows.properties')}</button>
          </>
        ) : null}
        {msg && <span style={{ color: 'var(--sd-muted)', fontSize: 13 }}>{msg}</span>}
      </div>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        alignItems: 'center',
        padding: '8px 10px',
        border: '1px solid var(--sd-border)',
        borderRadius: 10,
        background: 'var(--sd-panel)',
        fontSize: 12,
      }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={scheduleEnabled}
            onChange={(e) => setScheduleEnabled(e.target.checked)}
          />
          {t('flows.scheduleEnabled')}
        </label>
        {scheduleEnabled ? (
          <>
            <label>
              {t('flows.cron')}
              <input
                style={{ ...inputStyle, width: 140, marginTop: 2 }}
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 */6 * * *"
              />
            </label>
            <label>
              {t('flows.timezone')}
              <input
                style={{ ...inputStyle, width: 140, marginTop: 2 }}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </label>
            <label>
              {t('flows.blackoutStart')}
              <input
                type="time"
                step={60}
                style={{ ...inputStyle, width: 120, marginTop: 2 }}
                value={blackoutStart}
                onChange={(e) => setBlackoutStart(normalizeBlackoutTime(e.target.value))}
                onBlur={(e) => setBlackoutStart(normalizeBlackoutTime(e.target.value))}
                title="HH:mm"
              />
            </label>
            <label>
              {t('flows.blackoutEnd')}
              <input
                type="time"
                step={60}
                style={{ ...inputStyle, width: 120, marginTop: 2 }}
                value={blackoutEnd}
                onChange={(e) => setBlackoutEnd(normalizeBlackoutTime(e.target.value))}
                onBlur={(e) => setBlackoutEnd(normalizeBlackoutTime(e.target.value))}
                title="HH:mm"
              />
            </label>
          </>
        ) : (
          <span style={{ color: 'var(--sd-muted)' }}>{t('flows.scheduleHint')}</span>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '180px 1fr 220px',
          gap: 12,
          flex: 1,
          minHeight: 0,
        }}
      >
        {!isMobile ? palette : null}

        <div
          ref={wrapperRef}
          style={{
            position: 'relative',
            border: '1px solid var(--sd-border)',
            borderRadius: 10,
            overflow: 'hidden',
            background: 'var(--sd-canvas)',
            minHeight: isMobile ? 360 : undefined,
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            defaultEdgeOptions={defaultEdgeOptions}
            onNodesChange={(changes) => {
              onNodesChange(changes);
              const removed = changes.filter((c) => c.type === 'remove').map((c) => ('id' in c ? c.id : null));
              if (removed.length) {
                setSelectedNode((sn) => (sn && removed.includes(sn.id) ? null : sn));
              }
            }}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            nodeTypes={types}
            onNodeClick={(_, n) => {
              setSelectedNode(n);
              if (isMobile) setMobilePanel('inspector');
            }}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeContextMenu={onEdgeContextMenu}
            onPaneContextMenu={onPaneContextMenu}
            onPaneClick={() => setMenu(null)}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
          >
            <Background />
            <Controls />
            {!isMobile ? <MiniMap /> : null}
          </ReactFlow>
          <FlowContextMenu
            menu={menu}
            onClose={() => setMenu(null)}
            onAction={handleContextAction}
          />
        </div>

        {!isMobile ? inspector : null}
      </div>

      {isMobile && mobilePanel ? (
        <>
          <div
            role="presentation"
            onClick={() => setMobilePanel(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60 }}
          />
          <div
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 0,
              maxHeight: '70dvh',
              zIndex: 70,
              padding: 12,
              background: 'var(--sd-bg)',
              borderTop: '1px solid var(--sd-border)',
              borderRadius: '16px 16px 0 0',
              boxShadow: '0 -8px 32px rgba(0,0,0,0.25)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button type="button" style={btnSecondaryStyle} onClick={() => setMobilePanel(null)}>✕</button>
            </div>
            <div style={{ maxHeight: 'calc(70dvh - 56px)', overflow: 'auto' }}>
              {mobilePanel === 'palette' ? palette : inspector}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

type Props = {
  initial: FlowSummary | null;
  onBack: () => void;
  onSaved: (flow: FlowSummary) => void;
};

export function FlowWorkspace({ initial, onBack, onSaved }: Props) {
  return (
    <ReactFlowProvider>
      <FlowCanvas initial={initial} onBack={onBack} onSaved={onSaved} />
    </ReactFlowProvider>
  );
}
