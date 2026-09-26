/**
 * Migra graphs legados: condition→if; multi-handles de acções (só `out`) → CASE a seguir.
 * Nodes com saídas nativas (check_image_update, run_flow, if, case) não são tocados.
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

/** Acções que no modelo antigo só tinham `out` — multi-handles legados viram CASE. */
const LEGACY_SINGLE_OUT_ACTIONS = new Set([
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

  const actionIds = nodes
    .filter((n) => LEGACY_SINGLE_OUT_ACTIONS.has(nodeTypeOf(n)))
    .map((n) => n.id);

  for (const actionId of actionIds) {
    const outgoing = edges.filter((e) => e.source === actionId);
    const handles = new Set(
      outgoing.map((e) => String(e.sourceHandle || 'out')),
    );

    // Um handle (ou nenhum): normalizar para out — nunca inserir CASE
    if (handles.size <= 1) {
      edges = edges.map((e) => (
        e.source === actionId
          ? { ...e, sourceHandle: 'out' }
          : e
      ));
      continue;
    }

    // Já só out/ok (aliases) — sem CASE
    const nonOut = [...handles].filter((h) => h !== 'out' && h !== 'ok' && h !== 'success');
    if (nonOut.length === 0) {
      edges = edges.map((e) => (
        e.source === actionId
          ? { ...e, sourceHandle: 'out' }
          : e
      ));
      continue;
    }

    // Multi-handle legado → inserir CASE uma vez
    const action = nodes.find((n) => n.id === actionId)!;
    const caseId = uuid();
    const pos = action.position || { x: 0, y: 0 };
    const cases = nonOut.map((h) => ({ id: h, match: h }));

    nodes.push({
      id: caseId,
      type: 'case',
      position: { x: pos.x + 220, y: pos.y },
      data: {
        nodeType: 'case',
        field: 'lastOutcome',
        cases,
        label: 'CASE',
      } as never,
    });

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
        sourceHandle: h === 'ok' || h === 'out' || h === 'success' ? 'else' : h,
        targetHandle: e.targetHandle || 'in',
      });
    }
  }

  // Remover CASE inseridos por engano após nodes com saídas nativas (check / run_flow).
  // Cada save antigo criava mais um elo; aqui desfazemos a cadeia.
  const NATIVE_BRANCH = new Set(['check_image_update', 'run_flow']);
  let unwrapped = true;
  while (unwrapped) {
    unwrapped = false;
    for (const n of [...nodes]) {
      if (!NATIVE_BRANCH.has(nodeTypeOf(n))) continue;
      const outs = edges.filter((e) => e.source === n.id);
      for (const e of outs) {
        const mid = nodes.find((x) => x.id === e.target);
        if (!mid || nodeTypeOf(mid) !== 'case') continue;
        const caseOut = edges.filter((ce) => ce.source === mid.id);
        edges = edges.filter((x) => !(x.source === n.id && x.target === mid.id) && x.source !== mid.id);
        for (const ce of caseOut) {
          const h = String(ce.sourceHandle || 'out');
          edges.push({
            id: ce.id || `e-${n.id}-${ce.target}-${h}`,
            source: n.id,
            target: ce.target,
            sourceHandle: h === 'out' || h === 'ok' || h === 'success'
              ? (nodeTypeOf(n) === 'check_image_update' ? 'update' : 'success')
              : h,
            targetHandle: ce.targetHandle || 'in',
          });
        }
        const stillUsed = edges.some((x) => x.source === mid.id || x.target === mid.id);
        if (!stillUsed) {
          nodes = nodes.filter((x) => x.id !== mid.id);
        }
        unwrapped = true;
      }
    }
  }

  return { nodes, edges };
}
