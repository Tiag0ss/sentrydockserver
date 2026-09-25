/**
 * Migra graphs legados: condition→if; multi-handles de acções → CASE a seguir.
 */
import { v4 as uuid } from 'uuid';

type GNode = {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
  [k: string]: unknown;
};

type GEdge = {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  [k: string]: unknown;
};

type FlowGraph = { nodes: GNode[]; edges: GEdge[] };

const ACTION_TYPES = new Set([
  'check_image_update',
  'pull_image',
  'recreate_container',
  'compose_up',
  'compose_down',
  'notify',
  'webhook',
  'wait_approval',
  'split',
  'join',
  'wait_healthy',
  'rollback',
]);

function nodeTypeOf(n: GNode): string {
  const t = String(n.type || n.data?.nodeType || '');
  return t === 'condition' ? 'if' : t;
}

export function migrateFlowGraph(graph: unknown): FlowGraph {
  const g = (graph && typeof graph === 'object'
    ? graph
    : { nodes: [], edges: [] }) as FlowGraph;
  let nodes = [...(g.nodes || [])].map((n) => {
    const t = String(n.type || n.data?.nodeType || '');
    if (t === 'condition') {
      return {
        ...n,
        type: 'if',
        data: { ...n.data, nodeType: 'if', field: n.data?.field || 'lastResult' },
      };
    }
    return {
      ...n,
      data: { ...n.data, nodeType: String(n.data?.nodeType || n.type || '') },
    };
  });
  let edges = [...(g.edges || [])];

  const actionIds = nodes.filter((n) => ACTION_TYPES.has(nodeTypeOf(n))).map((n) => n.id);

  for (const actionId of actionIds) {
    const outgoing = edges.filter((e) => e.source === actionId);
    const handles = new Set(
      outgoing.map((e) => String(e.sourceHandle || 'out')),
    );
    // Já só out, ou sem arestas
    if (handles.size <= 1 && (handles.has('out') || handles.has('ok') || handles.size === 0)) {
      edges = edges.map((e) => (
        e.source === actionId
          ? { ...e, sourceHandle: 'out' }
          : e
      ));
      continue;
    }
    // Multi-handle → inserir CASE
    const action = nodes.find((n) => n.id === actionId)!;
    const caseId = uuid();
    const pos = action.position || { x: 0, y: 0 };
    const cases = [...handles]
      .filter((h) => h !== 'else')
      .map((h) => ({ id: h, match: h }));

    nodes.push({
      id: caseId,
      type: 'case',
      position: { x: pos.x + 220, y: pos.y },
      data: {
        nodeType: 'case',
        field: 'lastOutcome',
        cases,
        label: 'CASE',
      },
    });

    // Remover edges antigas do action; ligar action→case; case→targets
    edges = edges.filter((e) => e.source !== actionId);
    edges.push({
      id: `e-${actionId}-${caseId}`,
      source: actionId,
      target: caseId,
      sourceHandle: 'out',
      targetHandle: 'in',
    });
    for (const e of outgoing) {
      const h = String(e.sourceHandle || 'out');
      edges.push({
        id: e.id || `e-${caseId}-${e.target}-${h}`,
        source: caseId,
        target: e.target,
        sourceHandle: h === 'ok' ? 'else' : h,
        targetHandle: e.targetHandle || 'in',
      });
    }
  }

  return { nodes, edges };
}
