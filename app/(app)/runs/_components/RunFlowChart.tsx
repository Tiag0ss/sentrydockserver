'use client';

import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FlowCard } from '@/app/(app)/flows/_components/FlowCard';
import { normalizeHandle, NODE_TYPES_LIST } from '@/app/(app)/flows/_components/flowConstants';
import { useI18n } from '@/lib/i18n/I18nProvider';

const nodeTypes = { flowCard: FlowCard };

export type RunGraph = {
  nodes: Array<{
    id: string;
    type?: string;
    position?: { x: number; y: number };
    data?: Record<string, unknown>;
  }>;
  edges: Array<{
    id?: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
};

export type NodeStatusMap = Record<string, {
  status: string;
  attempts: number;
  lastError: string | null;
}>;

type Props = {
  graph: RunGraph;
  nodeStatuses: NodeStatusMap;
  currentNodeId: string | null;
};

function statusColor(status: string | undefined, isCurrent: boolean): {
  border: string;
  background: string;
  handle: string;
} {
  if (status === 'success') {
    return { border: '#3dd68c', background: 'rgba(61, 214, 140, 0.12)', handle: '#3dd68c' };
  }
  if (status === 'failed') {
    return { border: 'var(--danger)', background: 'rgba(240, 113, 120, 0.14)', handle: 'var(--danger)' };
  }
  if (status === 'rejected') {
    return { border: 'var(--warn)', background: 'rgba(255, 180, 84, 0.16)', handle: 'var(--warn)' };
  }
  if (status === 'running' || isCurrent) {
    return { border: 'var(--accent)', background: 'rgba(61, 214, 198, 0.14)', handle: 'var(--accent)' };
  }
  if (status === 'interrupted') {
    return { border: 'var(--warn)', background: 'rgba(255, 180, 84, 0.14)', handle: 'var(--warn)' };
  }
  return { border: 'var(--border)', background: 'var(--panel)', handle: '#5a7aa8' };
}

function RunFlowCanvas({ graph, nodeStatuses, currentNodeId }: Props) {
  const { t } = useI18n();

  const { nodes, edges } = useMemo(() => {
    const rfNodes: Node[] = (graph.nodes || []).map((raw, i) => {
      const nodeType = String(raw.type || raw.data?.nodeType || 'notify');
      const st = nodeStatuses[raw.id];
      const isCurrent = currentNodeId === raw.id;
      const colors = statusColor(st?.status, isCurrent);
      const labelKey = `nodes.${nodeType}`;
      const translated = t(labelKey);
      return {
        id: raw.id,
        type: 'flowCard',
        position: raw.position || { x: 80 + (i % 4) * 260, y: 80 + Math.floor(i / 4) * 140 },
        draggable: false,
        selectable: true,
        data: {
          ...raw.data,
          label: translated === labelKey
            ? (NODE_TYPES_LIST.find((n) => n.type === nodeType) ? nodeType : String(raw.data?.label || nodeType))
            : translated,
          nodeType,
          runStatus: st?.status || (isCurrent ? 'running' : 'pending'),
          runError: st?.lastError || null,
          runAttempts: st?.attempts || 0,
          runColors: colors,
          isCurrent,
        },
      };
    });

    const statusOf = (id: string) => nodeStatuses[id]?.status;
    const isDone = (s?: string) => s === 'success' || s === 'rejected';
    const isActive = (s?: string) => s === 'success' || s === 'running' || s === 'failed' || s === 'rejected';
    const rfEdges: Edge[] = (graph.edges || []).map((e, i) => {
      const srcStatus = statusOf(e.source);
      const tgtStatus = statusOf(e.target);
      const bothOk = isDone(srcStatus) && isActive(tgtStatus);
      const failedPath = srcStatus === 'failed' || tgtStatus === 'failed';
      const rejectedPath = srcStatus === 'rejected' || tgtStatus === 'rejected';
      const stroke = failedPath && tgtStatus === 'failed'
        ? 'var(--danger)'
        : rejectedPath && (srcStatus === 'rejected' || tgtStatus === 'rejected') && bothOk
          ? 'var(--warn)'
          : bothOk
            ? '#3dd68c'
            : '#5a7aa8';
      const type = String(
        (graph.nodes || []).find((n) => n.id === e.source)?.type
        || (graph.nodes || []).find((n) => n.id === e.source)?.data?.nodeType
        || '',
      );
      return {
        id: e.id || `e-${e.source}-${e.target}-${i}`,
        source: e.source,
        target: e.target,
        sourceHandle: normalizeHandle(type, e.sourceHandle),
        targetHandle: e.targetHandle || 'in',
        type: 'smoothstep',
        animated: tgtStatus === 'running',
        style: { stroke, strokeWidth: bothOk || failedPath || rejectedPath ? 2.5 : 1.5 },
      };
    });

    return { nodes: rfNodes, edges: rfEdges };
  }, [graph, nodeStatuses, currentNodeId, t]);

  return (
    <div style={{ height: 420, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: '#0a1020' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}

export function RunFlowChart(props: Props) {
  if (!props.graph?.nodes?.length) return null;
  return (
    <ReactFlowProvider>
      <RunFlowCanvas {...props} />
    </ReactFlowProvider>
  );
}

export function RunStatusLegend() {
  const { t } = useI18n();
  const items = [
    { color: '#3dd68c', label: t('runs.legendSuccess') },
    { color: 'var(--danger)', label: t('runs.legendFailed') },
    { color: 'var(--warn)', label: t('runs.legendRejected') },
    { color: 'var(--accent)', label: t('runs.legendRunning') },
    { color: 'var(--warn)', label: t('runs.legendInterrupted') },
    { color: 'var(--border)', label: t('runs.legendPending') },
  ];
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 10,
            height: 10,
            borderRadius: 3,
            background: it.color,
            border: `1px solid ${it.color}`,
          }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
