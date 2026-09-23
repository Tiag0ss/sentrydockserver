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
import { NODE_TYPES_LIST, getNodeOutputs, normalizeHandle, btnStyle, btnSecondaryStyle, inputStyle } from './flowConstants';
import type { FlowSummary } from './FlowsList';
import { useI18n } from '@/lib/i18n/I18nProvider';

const defaultEdgeOptions = {
  type: 'smoothstep' as const,
  animated: false,
  style: { stroke: '#5a7aa8' },
};

const nodeTypes = { flowCard: FlowCard };

function portLabelKey(id: string) {
  return `ports.${id}`;
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
  edgeLabel: (portId: string) => string,
): Edge[] {
  const typeById = new Map(
    (graphNodes || []).map((raw) => {
      const n = raw as { id: string; type?: string; data?: { nodeType?: string } };
      return [n.id, String(n.type || n.data?.nodeType || '')] as const;
    }),
  );
  return ((graphEdges || []) as Edge[])
    .filter((e) => e.source !== e.target)
    .map((e) => {
    const type = typeById.get(e.source) || '';
    const outputs = getNodeOutputs(type);
    const sourceHandle = normalizeHandle(type, e.sourceHandle);
    return {
      ...e,
      sourceHandle,
      targetHandle: e.targetHandle || 'in',
      deletable: true,
      label: e.label ?? (outputs.length > 1 ? edgeLabel(sourceHandle) : undefined),
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
  const edgePortLabel = useCallback((portId: string) => {
    const key = portLabelKey(portId);
    const translated = t(key);
    return translated === key ? portId : translated;
  }, [t]);

  const [flowId, setFlowId] = useState<string | null>(initial?.id ?? null);
  const [name, setName] = useState(initial?.name ?? t('flows.newName'));
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    initial ? toFlowNodes(initial.graph.nodes, nodeLabel) : [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initial ? toFlowEdges(initial.graph.edges, initial.graph.nodes, edgePortLabel) : [],
  );
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [msg, setMsg] = useState('');
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  useEffect(() => {
    if (!initial) return;
    setFlowId(initial.id);
    setName(initial.name);
    setNodes(toFlowNodes(initial.graph.nodes, nodeLabel));
    setEdges(toFlowEdges(initial.graph.edges, initial.graph.nodes, edgePortLabel));
  }, [initial, setNodes, setEdges, nodeLabel, edgePortLabel]);

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
      const outputs = getNodeOutputs(String(sourceNode?.data.nodeType || ''));
      const handleId = normalizeHandle(
        String(sourceNode?.data.nodeType || ''),
        c.sourceHandle || outputs[0]?.id || 'ok',
      );
      const portLabel = outputs.length > 1 ? edgePortLabel(handleId) : undefined;
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
    if (flowId) {
      await api(`/flows/${flowId}`, { method: 'PUT', body: JSON.stringify({ name, graph }) });
      onSaved({
        id: flowId,
        name,
        description: initial?.description ?? null,
        updatedAt: new Date().toISOString(),
        graph,
      });
    } else {
      const res = await api<{ id: string }>('/flows', { method: 'POST', body: JSON.stringify({ name, graph }) });
      setFlowId(res.id);
      onSaved({
        id: res.id,
        name,
        description: null,
        updatedAt: new Date().toISOString(),
        graph,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: 'calc(100vh - 80px)' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={onBack} style={btnSecondaryStyle}>{t('flows.back')}</button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ ...inputStyle, width: 220, marginTop: 0 }}
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
        {msg && <span style={{ color: 'var(--muted)', fontSize: 13 }}>{msg}</span>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 220px', gap: 12, flex: 1, minHeight: 0 }}>
        <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{t('flows.addCard')}</div>
          {NODE_TYPES_LIST.map((n) => (
            <button key={n.type} type="button" onClick={() => addNode(n.type)} style={{
              display: 'block', width: '100%', textAlign: 'left', background: 'transparent', color: 'var(--text)',
              border: '1px solid var(--border)', padding: 6, borderRadius: 6, cursor: 'pointer', marginBottom: 4, fontSize: 12,
            }}>{nodeLabel(n.type)}</button>
          ))}
        </div>

        <div ref={wrapperRef} style={{ position: 'relative', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: '#0a1020' }}>
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
            onNodeClick={(_, n) => setSelectedNode(n)}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeContextMenu={onEdgeContextMenu}
            onPaneContextMenu={onPaneContextMenu}
            onPaneClick={() => setMenu(null)}
            deleteKeyCode={['Backspace', 'Delete']}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
          <FlowContextMenu
            menu={menu}
            onClose={() => setMenu(null)}
            onAction={handleContextAction}
          />
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{t('flows.properties')}</div>
          <NodeInspector selectedNode={selectedNode} onPatch={patchNode} />
          {selectedNode && (
            <button
              type="button"
              onClick={() => handleContextAction('delete-node', { kind: 'node', id: selectedNode.id })}
              style={{ ...btnSecondaryStyle, marginTop: 12, color: 'var(--danger)', borderColor: 'var(--danger)', width: '100%' }}
            >
              {t('flows.removeNode')}
            </button>
          )}
        </div>
      </div>
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
