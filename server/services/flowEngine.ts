import { v4 as uuid } from 'uuid';
import { flowsRepo } from '../repositories/flowsRepo';
import { runsRepo } from '../repositories/domainRepo';
import { templatesRepo } from '../repositories/domainRepo';
import { agentsRepo } from '../repositories/agentsRepo';
import { agentGateway } from './agentGateway';
import { audit } from './audit';
import { createNotification } from './notificationsService';
import { migrateFlowGraph } from './flowGraphMigrate';
import { humanizeDisplayText, shortDigest } from '../utils/displayHumanize';
import {
  resolveDesiredImageRef,
  splitImageRef,
  targetInputFromNodeAndCtx,
} from './imageTarget';
import { getRegistryAuthForImage, resolveCatalogImageRef } from './imagesService';
import { deployComposeProject } from './composeService';
import { imagesRepo } from '../repositories/imagesRepo';
import { composeProjectsRepo } from '../repositories/composeRepo';
import { uiBus } from './uiBus';
import { redactWebhookUrl } from '../utils/webhookUrl';
import logger from '../utils/logger';

function notifyUiRuns() {
  try {
    uiBus.emit('runs');
  } catch {
    /* ignore */
  }
}

export type FlowNode = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  position?: { x: number; y: number };
};

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
};

export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[] };

type RunContext = Record<string, unknown>;

/** Nodes that emit side-effects only — never decide the run outcome. */
const SIDE_EFFECT_NODE_TYPES = new Set(['notify']);

function setRunOutcome(ctx: RunContext, outcome: 'success' | 'failed' | 'rejected') {
  const current = ctx.__runOutcome ? String(ctx.__runOutcome) : null;
  // Once failed/rejected, do not downgrade to success via a later happy branch
  if (current === 'failed' || current === 'rejected') return;
  ctx.__runOutcome = outcome;
}

function finalizeRunStatus(ctx: RunContext): 'success' | 'failed' | 'rejected' {
  const o = String(ctx.__runOutcome || 'success');
  if (o === 'failed' || o === 'rejected') return o;
  return 'success';
}

function parseGraph(json: string): FlowGraph {
  const raw = JSON.parse(json) as FlowGraph;
  const migrated = migrateFlowGraph(raw);
  return {
    nodes: migrated.nodes.map((n) => ({
      id: n.id,
      type: String(n.type || n.data?.nodeType || 'notify'),
      data: (n.data || {}) as Record<string, unknown>,
      position: n.position,
    })),
    edges: migrated.edges.map((e, i) => ({
      id: String(e.id || `e-${i}`),
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
    })),
  };
}

function getRetries(node: FlowNode): number {
  const r = Number(node.data?.retries ?? 0);
  return Number.isFinite(r) ? Math.max(0, r) : 0;
}

function extractHumanMessage(body: string): string {
  const trimmed = String(body || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>;
        if (typeof obj.text === 'string') return obj.text;
        if (typeof obj.message === 'string') return obj.message;
      }
    } catch {
      /* corpo não-JSON */
    }
  }
  return trimmed;
}

function resolveNodeMessage(
  node: FlowNode,
  fallback = '',
): { raw: string; templateKey: string | null } {
  const templateKey = String(node.data.templateKey || '').trim();
  let raw = String(node.data.message || fallback);
  if (templateKey) {
    const tpl = templatesRepo.findByKey(templateKey);
    if (tpl?.body) raw = extractHumanMessage(tpl.body);
  }
  return { raw, templateKey: templateKey || null };
}

function renderTemplate(body: string, ctx: RunContext, opts?: { human?: boolean }): string {
  const vars: Record<string, unknown> = { ...ctx };
  const formatTargetList = (raw: unknown): string => {
    if (!Array.isArray(raw) || raw.length === 0) return '';
    return raw.map((t) => {
      if (!t || typeof t !== 'object') return String(t);
      const row = t as Record<string, unknown>;
      const agentId = String(row.agentId || '');
      const agentName = agentId
        ? (agentsRepo.findById(agentId)?.name || agentId.slice(0, 8))
        : '';
      const name = String(row.containerName || '');
      return agentName ? `${name} @ ${agentName}` : name;
    }).filter(Boolean).join(', ');
  };
  if (Array.isArray(ctx.targets)) {
    vars.targetsList = formatTargetList(ctx.targets);
    vars.targetsCount = (ctx.targets as unknown[]).length;
  }
  if (Array.isArray(ctx.skippedTargets)) {
    vars.skippedTargetsList = formatTargetList(ctx.skippedTargets);
    vars.skippedTargetsCount = (ctx.skippedTargets as unknown[]).length;
  }
  if (opts?.human) {
    const agentId = ctx.agentId != null ? String(ctx.agentId) : '';
    if (agentId) {
      const name = agentsRepo.findById(agentId)?.name;
      if (name) {
        vars.agentName = name;
        // Templates antigos usam {{agentId}} — na UI preferimos o nome.
        vars.agentId = name;
      }
    }
    for (const key of ['newDigest', 'oldDigest', 'previousDigest'] as const) {
      if (typeof vars[key] === 'string') vars[key] = shortDigest(String(vars[key]));
    }
  }
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v == null) return '';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  });
}

function recordNodeFailure(ctx: RunContext, node: FlowNode, error: string) {
  ctx.error = error;
  ctx.lastError = error;
  ctx.failedNodeId = node.id;
  ctx.failedNodeType = node.type;
}

export function acquireLock(lockKey: string): boolean {
  return runsRepo.activeByLock(lockKey).length === 0;
}

/** Locks em memória por contentor (além do lock_key em flow_runs). */
const containerLocks = new Map<string, string>(); // lockKey → runId

function isRunDescendantOf(runId: string, ancestorId: string): boolean {
  let current: string | null = runId;
  const seen = new Set<string>();
  while (current) {
    if (current === ancestorId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    const row = runsRepo.findById(current);
    current = row?.parentRunId || null;
  }
  return false;
}

function tryAcquireContainerLock(lockKey: string, runId: string): boolean {
  const holder = containerLocks.get(lockKey);
  if (!holder) {
    containerLocks.set(lockKey, runId);
    return true;
  }
  if (holder === runId) return true;
  // Subflow (run_flow) pode partilhar o lock do ancestral que já o detém
  if (isRunDescendantOf(runId, holder)) return true;
  return false;
}

function releaseContainerLock(lockKey: string, runId: string) {
  if (containerLocks.get(lockKey) === runId) containerLocks.delete(lockKey);
}

export async function startFlowRun(opts: {
  flowId: string;
  triggerSource: string;
  context?: RunContext;
  lockKey?: string;
  dryRun?: boolean;
  actor?: string;
  parentRunId?: string | null;
  parentStepId?: string | null;
}): Promise<string> {
  const flow = flowsRepo.findById(opts.flowId);
  if (!flow) throw new Error('Flow not found');

  const lockKey = opts.lockKey || `flow:${opts.flowId}`;
  if (!acquireLock(lockKey)) {
    throw new Error('Another run is already active for this flow/target');
  }

  const runId = uuid();
  const now = new Date();
  runsRepo.insert({
      id: runId,
      flowId: opts.flowId,
      status: 'running',
      triggerSource: opts.triggerSource,
      lockKey,
      contextJson: JSON.stringify(opts.context || {}),
      dryRun: Boolean(opts.dryRun),
      startedAt: now,
      parentRunId: opts.parentRunId || null,
      parentStepId: opts.parentStepId || null,
    });

  await audit({
    actor: opts.actor || 'system',
    action: 'flow_run.started',
    entity: 'flow_run',
    entityId: runId,
    flowRunId: runId,
    payload: {
      dryRun: opts.dryRun,
      triggerSource: opts.triggerSource,
      parentRunId: opts.parentRunId || null,
    },
  });

  void advanceRun(runId);
  notifyUiRuns();
  return runId;
}

function entryNodes(graph: FlowGraph): FlowNode[] {
  const targets = new Set(graph.edges.map((e) => e.target));
  return graph.nodes.filter((n) => !targets.has(n.id) && n.type !== 'join');
}

function nextNodes(graph: FlowGraph, nodeId: string, handle?: string): FlowNode[] {
  const source = graph.nodes.find((n) => n.id === nodeId);
  const type = normalizeNodeType(source?.type || '');
  const from = graph.edges.filter((e) => e.source === nodeId);
  const wanted = handle !== undefined
    ? normalizeHandleId(type, handle, source?.data)
    : defaultOutHandle(type);
  const edges = from.filter((e) => normalizeHandleId(type, e.sourceHandle, source?.data) === wanted);
  return edges
    .map((e) => graph.nodes.find((n) => n.id === e.target))
    .filter(Boolean) as FlowNode[];
}

function normalizeNodeType(type: string): string {
  if (type === 'condition') return 'if';
  return type;
}

const ACTION_TYPES = new Set([
  'pull_image', 'recreate_container', 'compose_up', 'compose_down',
  'notify', 'webhook', 'wait_approval', 'join', 'wait_healthy', 'rollback',
]);

function defaultOutHandle(type: string): string {
  if (type === 'if') return 'true';
  if (type === 'case') return 'else';
  if (type === 'check_image_update') return 'update';
  if (type === 'run_flow') return 'success';
  return 'out';
}

function normalizeHandleId(
  type: string,
  handle: string | null | undefined,
  data?: Record<string, unknown>,
): string {
  const t = normalizeNodeType(type);
  if (t === 'if') {
    if (handle === 'true' || handle === 'false') return handle;
    return 'false';
  }
  if (t === 'case') {
    if (handle && handle !== 'out' && handle !== 'ok' && handle !== 'success') return handle;
    return 'else';
  }
  if (t === 'check_image_update') {
    if (handle === 'update' || handle === 'no_update' || handle === 'error') return handle;
    // legado: único handle out → ramo de update
    if (!handle || handle === 'out' || handle === 'success' || handle === 'ok') return 'update';
    return handle;
  }
  if (t === 'run_flow') {
    const wait = data?.wait !== false && data?.wait !== 'false';
    if (!wait) {
      if (!handle || handle === 'out' || handle === 'success' || handle === 'ok') return 'out';
      return handle || 'out';
    }
    if (handle === 'success' || handle === 'failed' || handle === 'error') return handle;
    if (!handle || handle === 'out' || handle === 'ok') return 'success';
    return handle;
  }
  if (t === 'split') {
    // Uma saída por contentor — preservar o handle; aliases genéricos → out
    if (!handle || handle === 'ok' || handle === 'success') return 'out';
    return handle;
  }
  if (ACTION_TYPES.has(t)) return 'out';
  if (!handle || handle === 'out' || handle === 'success' || handle === 'ok') return 'out';
  return handle;
}

function resolveSplitHandleForTarget(
  graph: FlowGraph,
  splitNode: FlowNode,
  t: { id?: string; agentId: string; containerName?: string },
): string {
  const from = graph.edges.filter((e) => e.source === splitNode.id);
  const handles = new Set(
    from.map((e) => normalizeHandleId('split', e.sourceHandle, splitNode.data)),
  );
  const containerName = String(t.containerName || '').trim();
  const targetId = String(t.id || (containerName ? `${t.agentId}:${containerName}` : '')).trim();
  const candidates = [targetId, containerName].filter(Boolean);
  for (const c of candidates) {
    if (handles.has(c)) return c;
  }
  // Match por branches configurados no nó
  const rawBranches = splitNode.data.branches;
  if (Array.isArray(rawBranches)) {
    for (const b of rawBranches) {
      if (!b || typeof b !== 'object') continue;
      const row = b as Record<string, unknown>;
      const bid = String(row.id || '').trim();
      const bAgent = String(row.agentId || '').trim();
      const bName = String(row.containerName || row.label || '').trim();
      const matches = (bid && bid === targetId)
        || (bName && bName === containerName && (!bAgent || bAgent === t.agentId));
      if (matches && bid && handles.has(bid)) return bid;
    }
  }
  // Legado: só usar `out` se NÃO houver handles por contentor
  const hasSpecific = [...handles].some((h) => h !== 'out' && h !== 'ok' && h !== 'success');
  if (!hasSpecific && handles.has('out')) return 'out';
  // Com handles por contentor, não fazer fallback para `out` (correria todos os caminhos)
  return targetId || containerName || 'out';
}

function findJoinFromSplit(graph: FlowGraph, splitNodeId: string): FlowNode | undefined {
  const starts = graph.edges
    .filter((e) => e.source === splitNodeId)
    .map((e) => graph.nodes.find((n) => n.id === e.target))
    .filter(Boolean) as FlowNode[];
  const q = [...starts];
  const seen = new Set<string>();
  while (q.length) {
    const n = q.shift()!;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    if (n.type === 'join') return n;
    q.push(...nextNodes(graph, n.id, 'out'));
    // Também seguir outros handles (run_flow success/failed, etc.)
    for (const e of graph.edges.filter((x) => x.source === n.id)) {
      const nxt = graph.nodes.find((x) => x.id === e.target);
      if (nxt) q.push(nxt);
    }
  }
  return undefined;
}

function setLastOutcome(ctx: RunContext, outcome: string, result?: boolean) {
  ctx.lastOutcome = outcome;
  const okOutcomes = new Set(['ok', 'update', 'approved', 'healthy', 'true']);
  ctx.lastResult = result ?? okOutcomes.has(outcome);
}

function parseCaseWhens(data: Record<string, unknown>): Array<{ id: string; match: string }> {
  const raw = data.cases;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c) => {
      if (!c || typeof c !== 'object') return null;
      const row = c as Record<string, unknown>;
      const id = String(row.id || row.match || '').trim();
      const match = String(row.match ?? row.id ?? '').trim();
      if (!id) return null;
      return { id, match: match || id };
    })
    .filter(Boolean) as Array<{ id: string; match: string }>;
}

async function upsertStep(runId: string, nodeId: string, branchId: string | null, status: string, patch: Partial<{
  attempts: number;
  lastError: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  detailJson: string | null;
}> = {}) {
  const existing = runsRepo.findStep(runId, nodeId, branchId);
  if (existing) {
    runsRepo.updateStep(existing.id, { status, ...patch });
    return existing.id;
  }
  const id = uuid();
  runsRepo.insertStep({
      id,
      runId,
      nodeId,
      branchId,
      status,
      attempts: patch.attempts ?? 0,
      lastError: patch.lastError ?? null,
      startedAt: patch.startedAt ?? null,
      finishedAt: patch.finishedAt ?? null,
      detailJson: patch.detailJson ?? null,
    });
  return id;
}

function detailJson(detail: Record<string, unknown>): string {
  return JSON.stringify(detail);
}

export async function resumeInterruptedRuns() {
  const stuck = runsRepo.byStatus(['running', 'interrupted', 'resume_pending']);

  for (const run of stuck) {
    const runningSteps = runsRepo.stepsByStatus(run.id, 'running');

    const summary = {
      runId: run.id,
      interruptedSteps: runningSteps.map((s) => s.nodeId),
      status: run.status,
    };

    for (const step of runningSteps) {
      runsRepo.updateStep(step.id, { status: 'interrupted', lastError: 'Interrupted by server restart' });
    }

    runsRepo.update(run.id, { status: 'resume_pending', summary: JSON.stringify(summary) });

    await audit({
      actor: 'system',
      action: 'flow_run.interrupted_resume',
      entity: 'flow_run',
      entityId: run.id,
      flowRunId: run.id,
      payload: summary,
    });

    // Auto-restart interrupted node actions
    void advanceRun(run.id, { resumeInterrupted: true });
  }
}

export async function userContinueRun(runId: string, opts: {
  continue: boolean;
  branchIds?: string[];
  targetTag?: string;
  targetRange?: string;
  targetMode?: string;
}) {
  const run = runsRepo.findById(runId);
  if (!run) throw new Error('Run not found');
  if (run.status !== 'awaiting_user' && run.status !== 'waiting_approval') {
    throw new Error('Run is not awaiting user');
  }
  const ctx = JSON.parse(run.contextJson || '{}') as RunContext;
  if (opts.branchIds) ctx.selectedBranchIds = opts.branchIds;
  if (opts.targetTag != null && String(opts.targetTag).trim()) {
    ctx.targetTag = String(opts.targetTag).trim();
  }
  if (opts.targetRange != null && String(opts.targetRange).trim()) {
    ctx.targetRange = String(opts.targetRange).trim();
  }
  if (opts.targetMode != null && String(opts.targetMode).trim()) {
    ctx.targetMode = String(opts.targetMode).trim();
  }

  if (run.status === 'waiting_approval') {
    const decision = opts.continue ? 'approved' : 'rejected';
    ctx.approvalDecision = decision;
    setLastOutcome(ctx, decision, decision === 'approved');
    if (decision === 'rejected') {
      setRunOutcome(ctx, 'rejected');
      ctx.error = 'rejected';
      ctx.lastError = 'rejected';
      if (run.currentNodeId) {
        ctx.failedNodeId = run.currentNodeId;
        ctx.failedNodeType = 'wait_approval';
      }
    } else {
      delete ctx.error;
      delete ctx.lastError;
      delete ctx.failedNodeId;
      delete ctx.failedNodeType;
    }
    if (run.currentNodeId) {
      await upsertStep(
        runId,
        run.currentNodeId,
        null,
        decision === 'approved' ? 'success' : 'rejected',
        { finishedAt: new Date(), lastError: null },
      );
    }
    runsRepo.update(runId, { status: 'running', contextJson: JSON.stringify(ctx) });
    await audit({
      actor: 'user',
      action: decision === 'approved' ? 'flow_run.approved' : 'flow_run.rejected',
      entity: 'flow_run',
      entityId: runId,
      flowRunId: runId,
      payload: { decision, nodeId: run.currentNodeId },
    });
    void advanceRun(runId, { afterUserContinue: true });
    notifyUiRuns();
    return;
  }

  if (!opts.continue) {
    if (run.currentNodeId) {
      const running = runsRepo.findStep(runId, run.currentNodeId, null);
      if (running && running.status === 'running') {
        runsRepo.updateStep(running.id, {
          status: 'failed',
          lastError: 'aborted',
          finishedAt: new Date(),
        });
      }
    }
    runsRepo.update(runId, { status: 'aborted', finishedAt: new Date(), currentNodeId: null });
    await audit({ actor: 'user', action: 'flow_run.aborted', entity: 'flow_run', entityId: runId, flowRunId: runId });
    notifyUiRuns();
    return;
  }
  runsRepo.update(runId, { status: 'running', contextJson: JSON.stringify(ctx) });
  notifyUiRuns();
  void advanceRun(runId, { afterUserContinue: true });
}

async function advancePinOnFlow(
  flowId: string,
  recreateNode: FlowNode,
  appliedImage: string,
  ctx: RunContext,
) {
  const flow = flowsRepo.findById(flowId);
  if (!flow) return;
  const graph = parseGraph(flow.graphJson);
  const { tag, digest } = splitImageRef(appliedImage);
  const pin = tag || digest || String(ctx.currentTag || ctx.targetTag || '');
  if (!pin) return;

  let changed = false;
  for (const n of graph.nodes) {
    if (n.type !== 'check_image_update') continue;
    const sameImageId = ctx.imageId && String(n.data.imageId || '') === String(ctx.imageId);
    const sameContainer =
      String(n.data.containerName || '') === String(recreateNode.data.containerName || ctx.containerName || '')
      || !n.data.containerName;
    if (!sameImageId && !sameContainer && String(n.data.image || '').split(':')[0] !== splitImageRef(appliedImage).repo) {
      continue;
    }
    n.data = {
      ...n.data,
      targetMode: 'pin_tag',
      targetTag: pin,
      image: appliedImage.includes(':') || appliedImage.includes('@')
        ? appliedImage
        : String(n.data.image || appliedImage),
    };
    changed = true;
  }
  // Also update the recreate node's image if present
  const rec = graph.nodes.find((n) => n.id === recreateNode.id);
  if (rec) {
    rec.data = { ...rec.data, image: appliedImage };
    changed = true;
  }
  if (changed) {
    flowsRepo.update(flowId, {
      graphJson: JSON.stringify(graph),
      updatedAt: new Date(),
    });
  }

  const catalogId = String(ctx.imageId || recreateNode.data.imageId || '').trim();
  if (catalogId) {
    const row = imagesRepo.findById(catalogId);
    if (row && (row.targetMode === 'pin_tag' || Boolean(ctx.advancePinOnSuccess) || Boolean(recreateNode.data.advancePinOnSuccess))) {
      imagesRepo.update(catalogId, {
        targetMode: 'pin_tag',
        targetTag: pin,
        updatedAt: new Date(),
      });
      changed = true;
    }
  }

  if (!changed) return;
  await audit({
    actor: 'system',
    action: 'flow.target_advanced',
    entity: 'flow',
    entityId: flowId,
    payload: { pin, image: appliedImage, nodeId: recreateNode.id, imageId: catalogId || null },
  });
}

type FlowTarget = {
  id: string;
  agentId: string;
  containerName: string;
  image?: string;
  oldDigest?: string;
  newDigest?: string;
};

function parseNodeTargets(data: Record<string, unknown>): FlowTarget[] {
  const raw = data.targets;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => {
      if (!t || typeof t !== 'object') return null;
      const row = t as Record<string, unknown>;
      const agentId = String(row.agentId || '').trim();
      const containerName = String(row.containerName || '').trim();
      if (!agentId || !containerName) return null;
      const id = String(row.id || `${agentId}:${containerName}`);
      return { id, agentId, containerName };
    })
    .filter(Boolean) as FlowTarget[];
}

function recoverTargetsFromCheckStep(runId: string): FlowTarget[] {
  const steps = runsRepo.steps(runId);
  // Mais recente primeiro — preferir check_image_update
  const checks = steps
    .filter((s) => {
      if (s.nodeId.startsWith('check_image_update')) return true;
      if (!s.detailJson) return false;
      try {
        const d = JSON.parse(s.detailJson) as { targets?: unknown; updateAvailable?: boolean };
        return Array.isArray(d.targets) && d.targets.length > 0 && d.updateAvailable === true;
      } catch {
        return false;
      }
    })
    .slice()
    .sort((a, b) => {
      const ta = a.finishedAt ? new Date(a.finishedAt).getTime() : 0;
      const tb = b.finishedAt ? new Date(b.finishedAt).getTime() : 0;
      return tb - ta;
    });
  for (const step of checks) {
    if (!step.detailJson) continue;
    try {
      const detail = JSON.parse(step.detailJson) as { targets?: unknown };
      if (!Array.isArray(detail.targets) || !detail.targets.length) continue;
      const parsed = detail.targets
        .map((t) => {
          if (!t || typeof t !== 'object') return null;
          const row = t as Record<string, unknown>;
          const agentId = String(row.agentId || '').trim();
          const containerName = String(row.containerName || '').trim();
          if (!agentId || !containerName) return null;
          return {
            id: String(row.id || `${agentId}:${containerName}`),
            agentId,
            containerName,
            image: row.image != null ? String(row.image) : undefined,
            oldDigest: row.oldDigest != null ? String(row.oldDigest) : undefined,
            newDigest: row.newDigest != null ? String(row.newDigest) : undefined,
          };
        })
        .filter(Boolean) as FlowTarget[];
      if (parsed.length) return parsed;
    } catch {
      /* ignore */
    }
  }
  return [];
}

/** Targets configurados nos nós check do flow (vazio = sem filtro explícito). */
function getFlowCheckTargets(flowId: string): FlowTarget[] {
  const flow = flowsRepo.findById(flowId);
  if (!flow) return [];
  const graph = parseGraph(flow.graphJson);
  const out: FlowTarget[] = [];
  for (const n of graph.nodes) {
    if (normalizeNodeType(n.type) !== 'check_image_update') continue;
    out.push(...parseNodeTargets(n.data));
  }
  return out;
}

function targetKey(agentId: string, containerName: string): string {
  return `${agentId}:${containerName}`;
}

function flowTargetsInclude(
  targets: FlowTarget[],
  agentId: string,
  containerName: string,
): boolean {
  const key = targetKey(agentId, containerName);
  return targets.some(
    (t) => targetKey(t.agentId, t.containerName) === key
      || (t.agentId === agentId && t.containerName === containerName),
  );
}

/** Contentor Docker Compose: `{project}-{service}-{n}` (não confundir container-test com container-test2). */
function containerBelongsToComposeProject(containerName: string, projectName: string): boolean {
  const name = containerName.trim();
  const project = projectName.trim();
  if (!name || !project) return false;
  return name === project || name.startsWith(`${project}-`);
}

/** Dedup de run_flow sem targets no filho: uma execução por (parentRun, node). */
const runFlowOnceKeys = new Set<string>();

function containerLockKey(agentId: string, containerName: string): string {
  return `container:${agentId}:${containerName}`;
}

async function resolveNodeImage(
  nodeData: Record<string, unknown>,
  ctx: RunContext,
  preferAgentId?: string,
): Promise<{ image: string; secretId: string | null; provider: string | null; fromCatalog: boolean }> {
  const imageId = String(nodeData.imageId || ctx.imageId || '').trim();
  if (imageId) {
    const resolved = await resolveCatalogImageRef(imageId, { preferAgentId });
    ctx.image = resolved.imageRef;
    ctx.imageId = resolved.id;
    if (resolved.secretId) ctx.secretId = resolved.secretId;
    return {
      image: resolved.imageRef,
      secretId: resolved.secretId,
      provider: resolved.provider,
      fromCatalog: true,
    };
  }
  return {
    image: String(nodeData.image || ctx.image || ''),
    secretId: String(nodeData.secretId || ctx.secretId || '') || null,
    provider: null,
    fromCatalog: false,
  };
}

async function executeNode(
  runId: string,
  node: FlowNode,
  ctx: RunContext,
  branchId: string | null,
  dryRun: boolean,
): Promise<'success' | 'failed' | 'waiting'> {
  const retries = getRetries(node);
  let attempts = 0;
  let lastError: string | undefined;

  while (attempts <= retries) {
    attempts += 1;
    await upsertStep(runId, node.id, branchId, 'running', {
      attempts,
      startedAt: new Date(),
      lastError: null,
    });
    runsRepo.update(runId, { currentNodeId: node.id, status: 'running' });
    notifyUiRuns();

    try {
      if (dryRun && ['pull_image', 'recreate_container', 'compose_up', 'compose_down', 'rollback'].includes(node.type)) {
        await audit({
          actor: 'system',
          action: 'flow_node.dry_run',
          entity: 'flow_node',
          entityId: node.id,
          flowRunId: runId,
          payload: { type: node.type, data: node.data },
        });
        await upsertStep(runId, node.id, branchId, 'success', {
          finishedAt: new Date(),
          detailJson: detailJson({
            dryRun: true,
            agentId: String(node.data.agentId || ctx.agentId || '') || undefined,
            containerName: String(node.data.containerName || ctx.containerName || '') || undefined,
            image: String(node.data.image || ctx.image || '') || undefined,
            projectPath: node.data.projectPath ? String(node.data.projectPath) : undefined,
            desiredDigest: ctx.newDigest ? String(ctx.newDigest) : undefined,
            previousDigest: ctx.previousDigest ? String(ctx.previousDigest) : undefined,
            oldDigest: ctx.oldDigest ? String(ctx.oldDigest) : undefined,
            newDigest: ctx.newDigest ? String(ctx.newDigest) : undefined,
          }),
        });
        return 'success';
      }

      switch (node.type) {
        case 'check_image_update': {
          const selected = parseNodeTargets(node.data);
          if (selected.length === 0) {
            const msg = 'No containers selected for check';
            setLastOutcome(ctx, 'error', false);
            ctx.__nextHandle = 'error';
            recordNodeFailure(ctx, node, msg);
            await upsertStep(runId, node.id, branchId, 'failed', {
              finishedAt: new Date(),
              lastError: msg,
              detailJson: detailJson({ error: msg }),
            });
            return 'failed';
          }

          const preferAgent = selected[0]?.agentId;
          const catalog = await resolveNodeImage(node.data, ctx, preferAgent);
          const auth = getRegistryAuthForImage({
            secretId: catalog.secretId,
            provider: catalog.provider,
            repository: catalog.image,
          });
          const targetInput = catalog.fromCatalog
            ? {
              image: catalog.image,
              targetMode: 'follow_tag' as const,
            }
            : targetInputFromNodeAndCtx(node.data, ctx);

          let resolved;
          try {
            if (catalog.fromCatalog) {
              resolved = {
                mode: 'follow_tag' as const,
                imageRef: catalog.image,
                repo: splitImageRef(catalog.image).repo,
                selectedTag: splitImageRef(catalog.image).tag,
                targetTag: null as string | null,
                targetRange: null as string | null,
              };
            } else {
              resolved = await resolveDesiredImageRef(
                targetInput,
                targetInput.targetMode === 'semver_range' && preferAgent
                  ? async () => {
                    const { repo } = splitImageRef(targetInput.image);
                    if (!repo) return [] as string[];
                    const res = await agentGateway.sendCommand(
                      preferAgent,
                      'image.listTags',
                      { imageRepo: repo, auth },
                      120_000,
                    ) as { tags?: string[] };
                    return res.tags || [];
                  }
                  : undefined,
              );
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setLastOutcome(ctx, 'error', false);
            ctx.__nextHandle = 'error';
            recordNodeFailure(ctx, node, msg);
            await upsertStep(runId, node.id, branchId, 'failed', {
              finishedAt: new Date(),
              lastError: msg,
              detailJson: detailJson({ error: msg }),
            });
            return 'failed';
          }

          const image = resolved.imageRef;
          const needUpdate: FlowTarget[] = [];
          const skipped: FlowTarget[] = [];
          const staleErrors: Array<{ id: string; error: string }> = [];
          let lastErr = '';

          for (const target of selected) {
            if (!agentGateway.isOnline(target.agentId)) {
              staleErrors.push({ id: target.id, error: 'agent offline' });
              lastErr = 'agent offline';
              continue;
            }
            try {
              // Revalidar: contentor ainda existe
              const insp = await agentGateway.sendCommand(
                target.agentId,
                'docker.inspect',
                { id: target.containerName },
              ).catch(() => null);
              if (!insp) {
                staleErrors.push({ id: target.id, error: 'container not found' });
                lastErr = 'container not found';
                continue;
              }

              const check = await agentGateway.sendCommand(
                target.agentId,
                'image.checkUpdate',
                {
                  id: target.containerName,
                  containerId: target.containerName,
                  image,
                  auth,
                },
                300_000,
              ) as {
                updateAvailable?: boolean;
                remoteDigest?: string;
                remoteDigests?: string[];
                localDigests?: string[];
                imageId?: string;
                image?: string;
                configImage?: string;
              };
              const row: FlowTarget = {
                ...target,
                image: String(check.image || image || ''),
                oldDigest: check.localDigests?.[0] || check.imageId || '',
                newDigest: check.remoteDigest || '',
              };
              if (check.updateAvailable) needUpdate.push(row);
              else skipped.push(row);
            } catch (err) {
              lastErr = err instanceof Error ? err.message : String(err);
              logger.warn('check_image_update target failed', {
                agentId: target.agentId,
                containerName: target.containerName,
                err: lastErr,
              });
              staleErrors.push({ id: target.id, error: lastErr });
            }
          }

          const allFailed = needUpdate.length === 0 && skipped.length === 0;
          const updateAvailable = needUpdate.length > 0;
          const first = needUpdate[0] || skipped[0];

          Object.assign(ctx, {
            updateAvailable,
            targets: needUpdate,
            skippedTargets: skipped,
            staleTargets: staleErrors,
            oldDigest: first?.oldDigest || '',
            newDigest: first?.newDigest || '',
            image: first?.image || image,
            containerName: first?.containerName || '',
            agentId: first?.agentId || preferAgent || ctx.agentId,
            secretId: catalog.secretId || node.data.secretId || ctx.secretId,
            imageId: catalog.fromCatalog ? (ctx.imageId || node.data.imageId) : ctx.imageId,
            targetMode: resolved.mode,
            targetTag: resolved.targetTag || ctx.targetTag || node.data.targetTag || '',
            targetRange: resolved.targetRange || ctx.targetRange || node.data.targetRange || '',
            currentTag: resolved.selectedTag || '',
            advancePinOnSuccess: Boolean(node.data.advancePinOnSuccess),
          });

          if (allFailed) {
            setLastOutcome(ctx, 'error', false);
            ctx.__nextHandle = 'error';
            if (lastErr) recordNodeFailure(ctx, node, lastErr);
          } else if (updateAvailable) {
            setLastOutcome(ctx, 'update', true);
            ctx.__nextHandle = 'update';
          } else {
            setLastOutcome(ctx, 'no_update', false);
            ctx.__nextHandle = 'no_update';
          }

          await upsertStep(runId, node.id, branchId, allFailed ? 'failed' : 'success', {
            finishedAt: new Date(),
            lastError: allFailed ? (lastErr || 'all targets failed') : null,
            detailJson: detailJson({
              image,
              targetMode: resolved.mode,
              selectedTag: resolved.selectedTag,
              // Omit on failure so the UI does not show "Up to date" for auth errors.
              ...(allFailed ? {} : { updateAvailable }),
              targetsCount: needUpdate.length,
              skippedCount: skipped.length,
              staleCount: staleErrors.length,
              selectedCount: selected.length,
              oldDigest: first?.oldDigest,
              newDigest: first?.newDigest,
              targets: needUpdate,
              skippedTargets: skipped,
              staleTargets: staleErrors,
              reason: allFailed
                ? (lastErr || 'all_failed')
                : (updateAvailable ? 'digest_mismatch' : 'up_to_date'),
            }),
          });
          await audit({
            actor: 'system',
            action: allFailed ? 'flow_node.failed' : 'flow_node.success',
            entity: 'flow_node',
            entityId: node.id,
            flowRunId: runId,
            payload: {
              type: node.type,
              attempts,
              targets: needUpdate.length,
              skipped: skipped.length,
              stale: staleErrors.length,
            },
          });
          return allFailed ? 'failed' : 'success';
        }
        case 'pull_image': {
          const agentId = String(node.data.agentId || ctx.agentId || '');
          const catalog = await resolveNodeImage(node.data, ctx, agentId);
          const targetInput = catalog.fromCatalog
            ? { image: catalog.image, targetMode: 'follow_tag' as const }
            : targetInputFromNodeAndCtx(node.data, ctx);
          let image = catalog.fromCatalog ? catalog.image : String(ctx.image || node.data.image || '');
          try {
            if (!catalog.fromCatalog && (targetInput.targetMode === 'semver_range' || targetInput.targetMode === 'pin_tag')) {
              const resolved = await resolveDesiredImageRef(
                targetInput,
                targetInput.targetMode === 'semver_range'
                  ? async () => {
                    const { repo } = splitImageRef(targetInput.image);
                    const auth = getRegistryAuthForImage({
                      secretId: catalog.secretId,
                      provider: catalog.provider,
                      repository: catalog.image,
                    });
                    const res = await agentGateway.sendCommand(
                      agentId,
                      'image.listTags',
                      { imageRepo: repo, auth },
                      120_000,
                    ) as { tags?: string[] };
                    return res.tags || [];
                  }
                  : undefined,
              );
              image = resolved.imageRef;
              ctx.image = image;
              ctx.currentTag = resolved.selectedTag || '';
            }
          } catch (err) {
            logger.warn('pull resolve target failed, using ctx.image', {
              err: err instanceof Error ? err.message : String(err),
            });
          }
          const auth = getRegistryAuthForImage({
            secretId: catalog.secretId,
            provider: catalog.provider,
            repository: catalog.image,
          });
          // save previous image id (for digest compare) + name:tag (for recreate/rollback)
          if (ctx.containerName) {
            try {
              const insp = await agentGateway.sendCommand(agentId, 'docker.inspect', { id: ctx.containerName }) as {
                Image?: string;
                Config?: { Image?: string };
              };
              ctx.previousDigest = insp.Image;
              const configImage = String(insp.Config?.Image || '');
              // Prefer a mutable name:tag for later recreate/rollback payloads.
              // After a digest-pinned rollback, Config.Image is `repo@sha256:…` — keep
              // the catalog/flow image (`repo:latest`) instead of that pin.
              if (image && !/^sha256:/i.test(image) && !/@sha256:/i.test(image)) {
                ctx.previousImage = image;
              } else if (configImage && !/^sha256:/i.test(configImage) && !/@sha256:/i.test(configImage)) {
                ctx.previousImage = configImage;
              } else if (configImage.includes('@sha256:')) {
                const repo = configImage.replace(/@sha256:[a-f0-9]+$/i, '');
                ctx.previousImage = image || `${repo}:latest`;
              }
            } catch (err) {
              logger.warn('could not inspect container for previous digest', {
                err: err instanceof Error ? err.message : String(err),
              });
            }
          }
          await agentGateway.sendCommand(agentId, 'docker.pull', { image, auth });
          await upsertStep(runId, node.id, branchId, 'success', {
            finishedAt: new Date(),
            detailJson: detailJson({
              agentId,
              image,
              containerName: ctx.containerName ? String(ctx.containerName) : undefined,
              previousDigest: ctx.previousDigest ? String(ctx.previousDigest) : undefined,
              previousImage: ctx.previousImage ? String(ctx.previousImage) : undefined,
              newDigest: ctx.newDigest ? String(ctx.newDigest) : undefined,
            }),
          });
          await audit({
            actor: 'system',
            action: 'flow_node.success',
            entity: 'flow_node',
            entityId: node.id,
            flowRunId: runId,
            payload: { type: node.type, attempts },
          });
          return 'success';
        }
        case 'recreate_container': {
          const agentId = String(node.data.agentId || ctx.agentId || '');
          const id = String(node.data.containerName || ctx.containerName || '');
          const image = String(node.data.image || ctx.image || '');
          const desiredDigest = ctx.newDigest ? String(ctx.newDigest) : undefined;
          await agentGateway.sendCommand(agentId, 'docker.recreate', { id, image, desiredDigest });
          if (Boolean(node.data.advancePinOnSuccess) || Boolean(ctx.advancePinOnSuccess)) {
            const runRow = runsRepo.findById(runId);
            if (runRow) await advancePinOnFlow(runRow.flowId, node, image, ctx);
          }
          await upsertStep(runId, node.id, branchId, 'success', {
            finishedAt: new Date(),
            detailJson: detailJson({
              agentId,
              containerName: id,
              image,
              desiredDigest,
              oldDigest: ctx.oldDigest ? String(ctx.oldDigest) : undefined,
            }),
          });
          await audit({
            actor: 'system',
            action: 'flow_node.success',
            entity: 'flow_node',
            entityId: node.id,
            flowRunId: runId,
            payload: { type: node.type, attempts },
          });
          return 'success';
        }
        case 'compose_up':
        case 'compose_down': {
          const agentId = String(node.data.agentId || ctx.agentId || '');
          const composeProjectId = String(node.data.composeProjectId || '').trim();
          const projectPath = String(node.data.projectPath || '').trim();
          const image = ctx.image ? String(ctx.image) : undefined;
          const branchContainer = ctx.containerName ? String(ctx.containerName) : '';

          // Dentro de um split: só fazer compose se o contentor do ramo pertencer a este projecto
          if (composeProjectId && branchContainer) {
            const project = composeProjectsRepo.findById(composeProjectId);
            if (project && !containerBelongsToComposeProject(branchContainer, project.name)) {
              setLastOutcome(ctx, 'ok', true);
              await upsertStep(runId, node.id, branchId, 'success', {
                finishedAt: new Date(),
                detailJson: detailJson({
                  agentId,
                  composeProjectId,
                  action: node.type === 'compose_up' ? 'up' : 'down',
                  skipped: true,
                  reason: 'container_not_in_project',
                  containerName: branchContainer,
                  projectName: project.name,
                }),
              });
              return 'success';
            }
          }

          if (composeProjectId && node.type === 'compose_up') {
            // Snapshot running image before compose replaces it (needed for :latest rollback).
            if (branchContainer && !ctx.previousDigest) {
              try {
                const insp = await agentGateway.sendCommand(agentId, 'docker.inspect', { id: branchContainer }) as {
                  Image?: string;
                  Config?: { Image?: string };
                };
                if (insp.Image) ctx.previousDigest = insp.Image;
                if (!ctx.previousImage) {
                  const configImage = String(insp.Config?.Image || '');
                  if (configImage.includes('@sha256:')) {
                    const repo = configImage.replace(/@sha256:[a-f0-9]+$/i, '');
                    ctx.previousImage = image || `${repo}:latest`;
                  } else if (configImage && !/^sha256:/i.test(configImage)) {
                    ctx.previousImage = configImage;
                  } else if (image) {
                    ctx.previousImage = image;
                  }
                }
              } catch (err) {
                logger.warn('could not inspect container before compose_up', {
                  err: err instanceof Error ? err.message : String(err),
                  containerName: branchContainer,
                });
              }
            }
            if (!ctx.previousDigest && ctx.oldDigest) {
              ctx.previousDigest = ctx.oldDigest;
            }
            if (!agentId) throw new Error('agentId required for compose project deploy');
            const result = await deployComposeProject(
              composeProjectId,
              { agentIds: [agentId], force: true },
              'system',
            );
            const row = result.results?.[0];
            if (row?.status === 'error') {
              throw new Error(row.error || 'compose deploy failed');
            }
            // Compose can report success without recreating when only :latest moved.
            // Fail the node if this branch container is still on the previous digest.
            const wantNew = ctx.newDigest ? String(ctx.newDigest) : '';
            if (branchContainer && wantNew) {
              try {
                const after = await agentGateway.sendCommand(agentId, 'docker.inspect', { id: branchContainer }) as {
                  Image?: string;
                };
                const got = String(after.Image || '');
                const wantNorm = wantNew.toLowerCase().replace(/^sha256:/, '');
                const gotNorm = got.toLowerCase().replace(/^sha256:/, '');
                if (gotNorm && wantNorm && !gotNorm.startsWith(wantNorm) && !wantNorm.startsWith(gotNorm.slice(0, 12))) {
                  throw new Error(
                    `compose_up left ${branchContainer} on ${got.slice(0, 19)}…, expected ${wantNew.slice(0, 19)}…`,
                  );
                }
              } catch (err) {
                if (err instanceof Error && err.message.startsWith('compose_up left')) throw err;
                logger.warn('could not verify digest after compose_up', {
                  err: err instanceof Error ? err.message : String(err),
                  containerName: branchContainer,
                });
              }
            }
            if (Boolean(node.data.advancePinOnSuccess) || Boolean(ctx.advancePinOnSuccess)) {
              const runRow = runsRepo.findById(runId);
              if (runRow && image) await advancePinOnFlow(runRow.flowId, node, image, ctx);
            }
            await upsertStep(runId, node.id, branchId, 'success', {
              finishedAt: new Date(),
              detailJson: detailJson({
                agentId,
                composeProjectId,
                action: 'up',
                image,
                skipped: Boolean(row?.skipped),
                containerName: branchContainer || undefined,
                projectPath: row?.projectPath || undefined,
              }),
            });
          } else {
            if (!projectPath) {
              throw new Error(
                'projectPath or composeProjectId is required for Compose nodes. For a standalone container, use Recreate instead of Compose up.',
              );
            }
            const composeRes = await agentGateway.sendCommand(agentId, 'docker.compose', {
              action: node.type === 'compose_up' ? 'up' : 'down',
              projectPath,
              ...(node.type === 'compose_up' && image ? { image } : {}),
            }) as { projectPath?: string };
            await upsertStep(runId, node.id, branchId, 'success', {
              finishedAt: new Date(),
              detailJson: detailJson({
                agentId,
                projectPath: composeRes.projectPath || projectPath,
                action: node.type === 'compose_up' ? 'up' : 'down',
                image,
              }),
            });
          }
          await audit({
            actor: 'system',
            action: 'flow_node.success',
            entity: 'flow_node',
            entityId: node.id,
            flowRunId: runId,
            payload: { type: node.type, attempts },
          });
          return 'success';
        }
        case 'notify': {
          try {
            const { raw, templateKey } = resolveNodeMessage(node, 'notify');
            let message = renderTemplate(raw, ctx, { human: true });
            message = humanizeDisplayText(message);
            if (dryRun) message = `[dry-run] ${message}`;
            createNotification({
              message,
              flowRunId: runId,
              level: String(node.data.level || ''),
              ctx,
            });
            await upsertStep(runId, node.id, branchId, 'success', {
              finishedAt: new Date(),
              detailJson: detailJson({
                message: message.slice(0, 500),
                templateKey: templateKey || undefined,
                dryRun: dryRun || undefined,
              }),
            });
            await audit({
              actor: 'system',
              action: 'flow_node.success',
              entity: 'flow_node',
              entityId: node.id,
              flowRunId: runId,
              payload: { type: node.type, attempts, dryRun },
            });
            return 'success';
          } catch (err) {
            logger.warn('notify failed (ignored for run outcome)', {
              runId,
              err: err instanceof Error ? err.message : String(err),
            });
            await upsertStep(runId, node.id, branchId, 'failed', {
              lastError: err instanceof Error ? err.message : String(err),
              finishedAt: new Date(),
            });
            return 'success';
          }
        }
        case 'webhook': {
          const url = String(node.data.url || '');
          const method = String(node.data.method || 'POST');
          let templateBody = String(node.data.templateBody || node.data.body || '{}');
          const templateKey = String(node.data.templateKey || '').trim();
          if (templateKey) {
            const tpl = templatesRepo.findByKey(templateKey);
            if (tpl?.body) templateBody = tpl.body;
          }
          const body = renderTemplate(templateBody, ctx);
          const safeUrl = redactWebhookUrl(url);
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...((node.data.headers as Record<string, string>) || {}),
          };
          try {
            const res = await fetch(url, { method, headers, body });
            const responseText = await res.text().catch(() => '');
            await audit({
              actor: 'system',
              action: 'webhook.sent',
              flowRunId: runId,
              payload: {
                url: safeUrl,
                status: res.status,
                templateKey: templateKey || null,
                bodyPreview: body.slice(0, 500),
                responsePreview: responseText.slice(0, 300) || undefined,
              },
            });
            if (!res.ok) {
              ctx.__nextHandle = 'error';
              setLastOutcome(ctx, 'error', false);
              setRunOutcome(ctx, 'failed');
              const hint = responseText.trim().slice(0, 180);
              const errMsg = hint
                ? `Webhook HTTP ${res.status}: ${hint}`
                : `Webhook HTTP ${res.status}`;
              recordNodeFailure(ctx, node, errMsg);
              await upsertStep(runId, node.id, branchId, 'failed', {
                lastError: errMsg,
                finishedAt: new Date(),
                detailJson: detailJson({
                  url: safeUrl,
                  method,
                  httpStatus: res.status,
                  responsePreview: responseText.slice(0, 300) || undefined,
                  branch: 'error',
                }),
              });
              return 'failed';
            }
            await upsertStep(runId, node.id, branchId, 'success', {
              finishedAt: new Date(),
              detailJson: detailJson({
                url: safeUrl,
                method,
                httpStatus: res.status,
                templateKey: templateKey || undefined,
              }),
            });
            await audit({
              actor: 'system',
              action: 'flow_node.success',
              entity: 'flow_node',
              entityId: node.id,
              flowRunId: runId,
              payload: { type: node.type, attempts },
            });
            return 'success';
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn('webhook failed', { runId, err: msg });
            ctx.__nextHandle = 'error';
            setLastOutcome(ctx, 'error', false);
            setRunOutcome(ctx, 'failed');
            recordNodeFailure(ctx, node, msg);
            await upsertStep(runId, node.id, branchId, 'failed', {
              lastError: msg,
              finishedAt: new Date(),
              detailJson: detailJson({
                url: safeUrl,
                method,
                branch: 'error',
              }),
            });
            await audit({
              actor: 'system',
              action: 'webhook.failed',
              flowRunId: runId,
              payload: { url: safeUrl, error: msg },
            });
            return 'failed';
          }
        }
        case 'wait_approval': {
          const { raw, templateKey } = resolveNodeMessage(node, '');
          const message = raw
            ? humanizeDisplayText(renderTemplate(raw, ctx, { human: true }))
            : '';
          if (message && !dryRun) {
            try {
              createNotification({
                message,
                flowRunId: runId,
                level: 'warn',
                ctx,
              });
            } catch (err) {
              logger.warn('wait_approval notify failed', {
                runId,
                err: err instanceof Error ? err.message : String(err),
              });
            }
          }
          runsRepo.update(runId, {
            status: 'waiting_approval',
            currentNodeId: node.id,
            contextJson: JSON.stringify(ctx),
          });
          notifyUiRuns();
          await upsertStep(runId, node.id, branchId, 'running', {
            detailJson: detailJson({
              message: message || undefined,
              templateKey: templateKey || undefined,
              image: ctx.image ? String(ctx.image) : undefined,
              containerName: ctx.containerName ? String(ctx.containerName) : undefined,
              targets: Array.isArray(ctx.targets) ? ctx.targets : undefined,
              skippedTargets: Array.isArray(ctx.skippedTargets) ? ctx.skippedTargets : undefined,
              targetsCount: Array.isArray(ctx.targets) ? (ctx.targets as unknown[]).length : undefined,
              skippedTargetsCount: Array.isArray(ctx.skippedTargets)
                ? (ctx.skippedTargets as unknown[]).length
                : undefined,
              oldDigest: ctx.oldDigest ? String(ctx.oldDigest) : undefined,
              newDigest: ctx.newDigest ? String(ctx.newDigest) : undefined,
              updateAvailable: ctx.updateAvailable != null ? Boolean(ctx.updateAvailable) : undefined,
            }),
          });
          return 'waiting';
        }
        case 'if':
        case 'condition': {
          const field = String(node.data.field || 'lastResult');
          const raw = ctx[field];
          const value = typeof raw === 'boolean' ? raw : Boolean(raw);
          ctx.__nextHandle = value ? 'true' : 'false';
          setLastOutcome(ctx, value ? 'true' : 'false', value);
          await upsertStep(runId, node.id, branchId, 'success', {
            finishedAt: new Date(),
            detailJson: detailJson({
              field,
              value,
              branch: value ? 'true' : 'false',
            }),
          });
          await audit({
            actor: 'system',
            action: 'flow_node.success',
            entity: 'flow_node',
            entityId: node.id,
            flowRunId: runId,
            payload: { type: 'if', attempts },
          });
          return 'success';
        }
        case 'case': {
          const field = String(node.data.field || 'lastOutcome');
          const raw = ctx[field];
          const value = raw == null ? '' : String(raw);
          const whens = parseCaseWhens(node.data);
          const hit = whens.find((w) => w.match === value);
          ctx.__nextHandle = hit ? hit.id : 'else';
          await upsertStep(runId, node.id, branchId, 'success', {
            finishedAt: new Date(),
            detailJson: detailJson({
              field,
              value,
              branch: String(ctx.__nextHandle),
            }),
          });
          await audit({
            actor: 'system',
            action: 'flow_node.success',
            entity: 'flow_node',
            entityId: node.id,
            flowRunId: runId,
            payload: { type: 'case', attempts, branch: ctx.__nextHandle },
          });
          return 'success';
        }
        case 'wait_healthy': {
          const agentId = String(node.data.agentId || ctx.agentId || '');
          const id = String(node.data.containerName || ctx.containerName || '');
          const timeout = Number(node.data.timeoutMs || 60_000);
          const probe = String(node.data.probeType || 'docker');
          const healthUrl = String(node.data.healthUrl || '');
          const autoRollback = Boolean(node.data.autoRollback);
          const start = Date.now();
          let healthy = false;
          while (Date.now() - start < timeout) {
            if (probe === 'http' && healthUrl) {
              try {
                const res = await fetch(healthUrl, { method: 'GET', signal: AbortSignal.timeout(5000) });
                if (res.ok) {
                  healthy = true;
                  break;
                }
              } catch {
                /* retry */
              }
            } else {
              const insp = await agentGateway.sendCommand(agentId, 'docker.inspect', { id }) as {
                State?: { Health?: { Status?: string }; Status?: string };
              };
              const health = insp.State?.Health?.Status;
              const status = insp.State?.Status;
              if (health === 'healthy' || (!health && status === 'running')) {
                healthy = true;
                break;
              }
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
          if (!healthy && autoRollback) {
            try {
              const image = String(
                ctx.previousImage
                || node.data.image
                || ctx.image
                || '',
              );
              const desiredDigest = ctx.previousDigest ? String(ctx.previousDigest) : undefined;
              if (image && id && agentId) {
                await agentGateway.sendCommand(agentId, 'docker.recreate', {
                  id,
                  image,
                  ...(desiredDigest ? { desiredDigest } : {}),
                });
                ctx.rolledBack = true;
              }
            } catch (err) {
              logger.warn('auto-rollback after unhealthy failed', {
                err: err instanceof Error ? err.message : String(err),
              });
            }
          }
          setLastOutcome(ctx, healthy ? 'healthy' : 'timeout', healthy);
          await upsertStep(runId, node.id, branchId, 'success', {
            finishedAt: new Date(),
            detailJson: detailJson({
              agentId,
              containerName: id,
              probe,
              healthUrl: healthUrl || undefined,
              healthy,
              rolledBack: Boolean(ctx.rolledBack),
              branch: healthy ? 'healthy' : 'timeout',
              elapsedMs: Date.now() - start,
            }),
          });
          await audit({
            actor: 'system',
            action: 'flow_node.success',
            entity: 'flow_node',
            entityId: node.id,
            flowRunId: runId,
            payload: { type: node.type, attempts },
          });
          return 'success';
        }
        case 'rollback': {
          const agentId = String(node.data.agentId || ctx.agentId || '');
          const id = String(node.data.containerName || ctx.containerName || '');
          // Always recreate with a name:tag — never with a raw image id (sha256:…).
          const image = String(ctx.previousImage || node.data.image || ctx.image || '');
          const desiredDigest = ctx.previousDigest || ctx.oldDigest
            ? String(ctx.previousDigest || ctx.oldDigest)
            : undefined;
          await agentGateway.sendCommand(agentId, 'docker.recreate', {
            id,
            image,
            ...(desiredDigest ? { desiredDigest } : {}),
          });
          await upsertStep(runId, node.id, branchId, 'success', {
            finishedAt: new Date(),
            detailJson: detailJson({
              agentId,
              containerName: id,
              previousImage: image,
              previousDigest: desiredDigest,
              oldDigest: ctx.oldDigest ? String(ctx.oldDigest) : undefined,
            }),
          });
          await audit({
            actor: 'system',
            action: 'flow_node.success',
            entity: 'flow_node',
            entityId: node.id,
            flowRunId: runId,
            payload: { type: node.type, attempts },
          });
          return 'success';
        }
        case 'run_flow': {
          const childFlowId = String(node.data.flowId || '').trim();
          if (!childFlowId) throw new Error('flowId is required for run_flow');
          if (childFlowId === String(ctx.flowId || '')) {
            throw new Error('run_flow cannot call the same flow (cycle)');
          }
          const wait = node.data.wait !== false && node.data.wait !== 'false';
          const branchAgentId = String(ctx.agentId || '').trim();
          const branchContainer = String(ctx.containerName || '').trim();
          const onceKey = `${runId}:${node.id}`;

          // Dentro de um split: só executar o filho se o contentor do ramo estiver nos targets do check do filho
          const childTargets = getFlowCheckTargets(childFlowId);
          if (branchAgentId && branchContainer && childTargets.length > 0) {
            if (!flowTargetsInclude(childTargets, branchAgentId, branchContainer)) {
              setLastOutcome(ctx, 'ok', true);
              ctx.__nextHandle = wait ? 'success' : 'out';
              await upsertStep(runId, node.id, branchId, 'success', {
                finishedAt: new Date(),
                detailJson: detailJson({
                  flowId: childFlowId,
                  wait,
                  skipped: true,
                  reason: 'target_not_in_child_flow',
                  containerName: branchContainer,
                  agentId: branchAgentId,
                }),
              });
              return 'success';
            }
          }

          // Uma única execução deste nó por run pai (evita 2º ramo a disparar o mesmo subflow)
          if (runFlowOnceKeys.has(onceKey)) {
            setLastOutcome(ctx, 'ok', true);
            ctx.__nextHandle = wait ? 'success' : 'out';
            await upsertStep(runId, node.id, branchId, 'success', {
              finishedAt: new Date(),
              detailJson: detailJson({
                flowId: childFlowId,
                wait,
                skipped: true,
                reason: 'already_started_for_parent',
              }),
            });
            return 'success';
          }
          runFlowOnceKeys.add(onceKey);

          const stepId = await upsertStep(runId, node.id, branchId, 'running', {
            startedAt: new Date(),
            detailJson: detailJson({ flowId: childFlowId, wait }),
          });

          const childCtx: RunContext = {
            image: ctx.image,
            imageId: ctx.imageId,
            agentId: ctx.agentId,
            containerName: ctx.containerName,
            secretId: ctx.secretId,
            // Não herdar targets do pai — o check do filho preenche o lote
            oldDigest: ctx.oldDigest,
            newDigest: ctx.newDigest,
            targetMode: ctx.targetMode,
            targetTag: ctx.targetTag,
            currentTag: ctx.currentTag,
          };

          let childRunId: string;
          try {
            childRunId = await startFlowRun({
              flowId: childFlowId,
              triggerSource: 'subflow',
              context: childCtx,
              dryRun,
              actor: 'system',
              parentRunId: runId,
              parentStepId: stepId,
              // Um subflow activo por nó run_flow neste run pai
              lockKey: `flow:${childFlowId}:parent:${runId}:${node.id}`,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setLastOutcome(ctx, 'error', false);
            ctx.__branchFailed = true;
            // Seguir handle error/failed (rollback) — não abortar o ramo sem encaminhar
            ctx.__nextHandle = wait ? 'error' : 'out';
            recordNodeFailure(ctx, node, msg);
            await upsertStep(runId, node.id, branchId, 'failed', {
              finishedAt: new Date(),
              lastError: msg,
              detailJson: detailJson({ flowId: childFlowId, wait, error: msg }),
            });
            return 'success';
          }

          ctx.childRunId = childRunId;

          if (!wait) {
            setLastOutcome(ctx, 'ok', true);
            ctx.__nextHandle = 'out';
            await upsertStep(runId, node.id, branchId, 'success', {
              finishedAt: new Date(),
              detailJson: detailJson({ flowId: childFlowId, childRunId, wait: false }),
            });
            await audit({
              actor: 'system',
              action: 'flow_node.success',
              entity: 'flow_node',
              entityId: node.id,
              flowRunId: runId,
              payload: { type: node.type, attempts, childRunId, wait: false },
            });
            return 'success';
          }

          // Esperar o filho terminar
          const terminal = new Set(['success', 'failed', 'aborted', 'rejected']);
          const deadline = Date.now() + Number(node.data.timeoutMs || 30 * 60_000);
          let childStatus = 'running';
          while (Date.now() < deadline) {
            const child = runsRepo.findById(childRunId);
            childStatus = child?.status || 'failed';
            if (terminal.has(childStatus)) break;
            await new Promise((r) => setTimeout(r, 1000));
          }
          if (!terminal.has(childStatus)) {
            childStatus = 'failed';
            setLastOutcome(ctx, 'error', false);
            ctx.__branchFailed = true;
            ctx.__nextHandle = 'error';
            await upsertStep(runId, node.id, branchId, 'failed', {
              finishedAt: new Date(),
              lastError: 'child run timeout',
              detailJson: detailJson({ flowId: childFlowId, childRunId, wait: true, status: childStatus }),
            });
            return 'success';
          }

          if (childStatus === 'success') {
            setLastOutcome(ctx, 'ok', true);
            ctx.__nextHandle = 'success';
            await upsertStep(runId, node.id, branchId, 'success', {
              finishedAt: new Date(),
              detailJson: detailJson({ flowId: childFlowId, childRunId, wait: true, status: childStatus }),
            });
            return 'success';
          }
          if (childStatus === 'rejected') {
            setLastOutcome(ctx, 'failed', false);
            ctx.__branchFailed = true;
            ctx.__nextHandle = 'failed';
            setRunOutcome(ctx, 'rejected');
            await upsertStep(runId, node.id, branchId, 'failed', {
              finishedAt: new Date(),
              lastError: 'child run rejected',
              detailJson: detailJson({ flowId: childFlowId, childRunId, wait: true, status: childStatus }),
            });
            return 'success'; // pai continua pelo handle failed
          }
          setLastOutcome(ctx, 'failed', false);
          ctx.__branchFailed = true;
          ctx.__nextHandle = 'failed';
          await upsertStep(runId, node.id, branchId, 'failed', {
            finishedAt: new Date(),
            lastError: `child run ${childStatus}`,
            detailJson: detailJson({ flowId: childFlowId, childRunId, wait: true, status: childStatus }),
          });
          return 'success'; // pai continua pelo handle failed
        }
        case 'split':
        case 'join':
          // handled by advanceRun orchestration
          break;
        default:
          throw new Error(`Unknown node type: ${node.type}`);
      }

      await upsertStep(runId, node.id, branchId, 'success', { finishedAt: new Date() });
      await audit({
        actor: 'system',
        action: 'flow_node.success',
        entity: 'flow_node',
        entityId: node.id,
        flowRunId: runId,
        payload: { type: node.type, attempts },
      });
      return 'success';
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      recordNodeFailure(ctx, node, lastError);
      await upsertStep(runId, node.id, branchId, 'failed', {
        lastError,
        finishedAt: new Date(),
      });
      await audit({
        actor: 'system',
        action: 'flow_node.failed',
        entity: 'flow_node',
        entityId: node.id,
        flowRunId: runId,
        payload: { type: node.type, attempts, error: lastError },
      });
      if (attempts <= retries) {
        await new Promise((r) => setTimeout(r, Math.min(5000, 500 * attempts)));
        continue;
      }
      return 'failed';
    }
  }
  return 'failed';
}

export async function advanceRun(runId: string, opts?: { resumeInterrupted?: boolean; afterUserContinue?: boolean }) {
  const run = runsRepo.findById(runId);
  if (!run) return;
  const flow = flowsRepo.findById(run.flowId);
  if (!flow) return;
  const graph = parseGraph(flow.graphJson);
  const ctx = JSON.parse(run.contextJson || '{}') as RunContext;
  const dryRun = Boolean(run.dryRun);
  ctx.runId = runId;
  ctx.flowId = run.flowId;

  try {
    if (opts?.resumeInterrupted) {
      runsRepo.update(runId, { status: 'running' });
      const interrupted = runsRepo.stepsByStatus(runId, 'interrupted');
      for (const step of interrupted) {
        const node = graph.nodes.find((n) => n.id === step.nodeId);
        if (!node) continue;
        const agentId = String(node.data.agentId || ctx.agentId || '');
        if (agentId && !agentGateway.isOnline(agentId)) {
          runsRepo.update(runId, { status: 'resume_pending' });
          return;
        }
        const result = await executeNode(runId, node, ctx, step.branchId, dryRun);
        if (result === 'failed') {
          runsRepo.update(runId, { status: 'awaiting_user', contextJson: JSON.stringify(ctx) });
          return;
        }
        if (result === 'waiting') return;
      }
    }

    // Simple sequential engine from entry (supports named handles; split/join basic)
    let queue: FlowNode[];
    if (opts?.afterUserContinue && run.currentNodeId) {
      const cur = graph.nodes.find((n) => n.id === run.currentNodeId);
      const handle = String(ctx.__nextHandle || 'out');
      delete ctx.__nextHandle;
      queue = cur ? nextNodes(graph, cur.id, handle) : entryNodes(graph);
    } else {
      queue = entryNodes(graph);
    }

    const visited = new Set<string>();

    while (queue.length) {
      const node = queue.shift()!;
      if (visited.has(node.id)) continue;
      visited.add(node.id);

      if (node.type === 'split') {
        const fromContext = String(node.data.targetsSource || '') === 'context'
          || !Array.isArray(node.data.targets)
          || (node.data.targets as unknown[]).length === 0;
        let targets = (
          fromContext && Array.isArray(ctx.targets)
            ? ctx.targets
            : (node.data.targets || [])
        ) as Array<{
          id?: string;
          agentId: string;
          containerName?: string;
          image?: string;
          oldDigest?: string;
          newDigest?: string;
        }>;

        // Recuperar targets do check se o contexto os perdeu (ex. após aprovação / subflow)
        if ((!targets || targets.length === 0) && fromContext) {
          const recovered = recoverTargetsFromCheckStep(runId);
          if (recovered.length) {
            targets = recovered;
            ctx.targets = recovered;
            logger.warn('split recovered targets from check step', {
              runId,
              count: recovered.length,
            });
          }
        }

        const join = findJoinFromSplit(graph, node.id);

        if (targets.length === 0) {
          const expectedWork = Boolean(ctx.updateAvailable)
            || String(ctx.approvalDecision || '') === 'approved'
            || String(ctx.lastOutcome || '') === 'update';
          if (expectedWork) {
            const msg = 'Split has no targets after check/approval — cannot update containers';
            setLastOutcome(ctx, 'failed', false);
            setRunOutcome(ctx, 'failed');
            recordNodeFailure(ctx, node, msg);
            await upsertStep(runId, node.id, null, 'failed', {
              finishedAt: new Date(),
              lastError: msg,
              detailJson: detailJson({
                error: msg,
                updateAvailable: ctx.updateAvailable,
                approvalDecision: ctx.approvalDecision,
              }),
            });
            if (join) {
              await upsertStep(runId, join.id, null, 'failed', {
                finishedAt: new Date(),
                lastError: msg,
              });
            }
            runsRepo.update(runId, {
              status: 'failed',
              finishedAt: new Date(),
              currentNodeId: null,
              contextJson: JSON.stringify(ctx),
              summary: msg,
            });
            return;
          }
          setLastOutcome(ctx, 'ok', true);
          ctx.branchResults = [];
          await upsertStep(runId, node.id, null, 'success', {
            finishedAt: new Date(),
            detailJson: detailJson({ targetsCount: 0, skipped: true }),
          });
          if (join) {
            await upsertStep(runId, join.id, null, 'success', { finishedAt: new Date() });
            queue.push(...nextNodes(graph, join.id, 'out'));
          }
          continue;
        }

        await upsertStep(runId, node.id, null, 'success', {
          finishedAt: new Date(),
          detailJson: detailJson({
            targetsCount: targets.length,
            handles: targets.map((t) => resolveSplitHandleForTarget(graph, node, t)),
          }),
        });

        const branches = targets.map((t) => {
          const branchId = uuid();
          // Não espalhar `t` depois de `id` — o target também tem `id` e sobrescrevia o UUID do branch
          runsRepo.insertBranch({
            id: branchId,
            runId,
            splitNodeId: node.id,
            agentId: t.agentId,
            containerName: t.containerName || null,
            status: 'running',
            contextJson: JSON.stringify({ ...ctx, ...t }),
          });
          return {
            branchId,
            id: t.id,
            agentId: t.agentId,
            containerName: t.containerName,
            image: t.image,
            oldDigest: t.oldDigest,
            newDigest: t.newDigest,
          };
        });

        await Promise.all(branches.map(async (b) => {
          const lockKey = b.containerName
            ? containerLockKey(b.agentId, b.containerName)
            : null;
          if (lockKey && !tryAcquireContainerLock(lockKey, runId)) {
            runsRepo.updateBranch(b.branchId, {
              status: 'failed',
              contextJson: JSON.stringify({
                ...ctx,
                error: 'container locked by another run',
              }),
            });
            return;
          }

          try {
            const bctx: RunContext = {
              ...ctx,
              agentId: b.agentId,
              containerName: b.containerName,
              image: b.image || ctx.image,
              oldDigest: b.oldDigest || ctx.oldDigest,
              newDigest: b.newDigest || ctx.newDigest,
            };
            const splitHandle = resolveSplitHandleForTarget(graph, node, b);
            const path = nextNodes(graph, node.id, splitHandle).filter((n) => n.type !== 'join');
            if (path.length === 0) {
              const msg = `No path from split for target ${b.containerName || b.agentId} (handle=${splitHandle})`;
              runsRepo.updateBranch(b.branchId, {
                status: 'failed',
                contextJson: JSON.stringify({ ...bctx, error: msg }),
              });
              return;
            }
            const localVisited = new Set<string>();
            while (path.length) {
              const n = path.shift()!;
              if (n.type === 'join') break;
              if (localVisited.has(n.id)) continue;
              localVisited.add(n.id);
              const r = await executeNode(runId, n, bctx, b.branchId, dryRun);
              if (r === 'waiting') {
                // Não deveria acontecer dentro de um ramo (aprovação fica antes do split)
                runsRepo.updateBranch(b.branchId, {
                  status: 'failed',
                  contextJson: JSON.stringify({
                    ...bctx,
                    error: 'unexpected waiting state inside split branch',
                  }),
                });
                return;
              }
              const h = bctx.__nextHandle !== undefined
                ? String(bctx.__nextHandle)
                : (r === 'failed' ? 'error' : 'out');
              delete bctx.__nextHandle;
              const next = nextNodes(graph, n.id, h).filter((x) => x.type !== 'join');
              if (r === 'failed' && next.length === 0) {
                setLastOutcome(bctx, 'error', false);
                runsRepo.updateBranch(b.branchId, { status: 'failed', contextJson: JSON.stringify(bctx) });
                return;
              }
              // Seguir handles (incl. failed/error → rollback) mesmo após falha do nó
              path.push(...next);
            }
            if (bctx.__branchFailed) {
              runsRepo.updateBranch(b.branchId, { status: 'failed', contextJson: JSON.stringify(bctx) });
            } else {
              setLastOutcome(bctx, 'ok', true);
              runsRepo.updateBranch(b.branchId, { status: 'success', contextJson: JSON.stringify(bctx) });
            }          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            runsRepo.updateBranch(b.branchId, {
              status: 'failed',
              contextJson: JSON.stringify({ ...ctx, error: msg }),
            });
          } finally {
            if (lockKey) releaseContainerLock(lockKey, runId);
          }
        }));

        const allBranches = runsRepo.branchesBySplit(runId, node.id);
        // Qualquer ramo ainda "running" = falha (ex. updateBranch com id errado no passado)
        for (const b of allBranches) {
          if (b.status === 'running') {
            runsRepo.updateBranch(b.id, {
              status: 'failed',
              contextJson: JSON.stringify({
                ...(JSON.parse(b.contextJson || '{}') as object),
                error: 'branch did not complete',
              }),
            });
          }
        }
        const finalized = runsRepo.branchesBySplit(runId, node.id);
        ctx.branchResults = finalized.map((b) => ({
          branchId: b.id,
          agentId: b.agentId,
          containerName: b.containerName,
          status: b.status,
        }));

        if (join) {
          const mode = String(join.data.mode || 'wait_all');
          if (mode === 'await_user') {
            runsRepo.update(runId, {
              status: 'awaiting_user',
              currentNodeId: join.id,
              contextJson: JSON.stringify(ctx),
            });
            return;
          }
          const anyFailed = finalized.some((b) => b.status !== 'success');
          if (mode === 'continue_successes') {
            const ok = finalized.filter((b) => b.status === 'success').map((b) => b.id);
            ctx.selectedBranchIds = ok;
            setLastOutcome(ctx, ok.length > 0 ? 'ok' : 'failed', ok.length > 0);
            if (ok.length === 0) setRunOutcome(ctx, 'failed');
          } else if (anyFailed) {
            setLastOutcome(ctx, 'failed', false);
            setRunOutcome(ctx, 'failed');
            await upsertStep(runId, join.id, null, 'failed', {
              finishedAt: new Date(),
              detailJson: detailJson({ mode, branchResults: ctx.branchResults }),
            });
            runsRepo.update(runId, { contextJson: JSON.stringify(ctx) });
            // Continuar para nós a seguir do join (IF → rollback / notify) em vez de abortar
            const afterJoin = nextNodes(graph, join.id, 'out');
            if (afterJoin.length) {
              queue.push(...afterJoin);
              continue;
            }
            runsRepo.update(runId, {
              status: 'failed',
              finishedAt: new Date(),
              currentNodeId: null,
              contextJson: JSON.stringify(ctx),
            });
            return;
          } else {
            setLastOutcome(ctx, 'ok', true);
          }

          // Avançar pin no catálogo após lote com sucesso
          if (!anyFailed && Boolean(ctx.advancePinOnSuccess) && ctx.image) {
            await advancePinOnFlow(run.flowId, node, String(ctx.image), ctx);
          }

          await upsertStep(runId, join.id, null, 'success', {
            finishedAt: new Date(),
            detailJson: detailJson({ mode, branchResults: ctx.branchResults }),
          });
          queue.push(...nextNodes(graph, join.id, 'out'));
        }
        continue;
      }

      if (node.type === 'join') {
        continue;
      }

      const result = await executeNode(runId, node, ctx, null, dryRun);
      runsRepo.update(runId, { contextJson: JSON.stringify(ctx) });

      if (result === 'waiting') return;
      if (result === 'failed') {
        setLastOutcome(ctx, 'error', false);
        if (!SIDE_EFFECT_NODE_TYPES.has(node.type)) {
          setRunOutcome(ctx, 'failed');
        }
        const failHandle = ctx.__nextHandle !== undefined
          ? String(ctx.__nextHandle)
          : 'out';
        delete ctx.__nextHandle;
        const outNext = nextNodes(graph, node.id, failHandle);
        if (outNext.length) {
          queue.push(...outNext);
          continue;
        }
        if (SIDE_EFFECT_NODE_TYPES.has(node.type)) {
          continue;
        }
        // Webhook (e similares sem aresta de erro): terminar a run como failed
        // em vez de awaiting_user — não há acção útil de "continuar" num POST falhado.
        if (node.type === 'webhook') {
          const status = finalizeRunStatus(ctx);
          runsRepo.update(runId, {
            status,
            finishedAt: new Date(),
            currentNodeId: null,
            contextJson: JSON.stringify(ctx),
          });
          await audit({
            actor: 'system',
            action: `flow_run.${status}`,
            entity: 'flow_run',
            entityId: runId,
            flowRunId: runId,
            payload: { outcome: status, failedNode: node.id, failedType: node.type },
          });
          notifyUiRuns();
          return;
        }
        runsRepo.update(runId, {
          status: 'awaiting_user',
          currentNodeId: node.id,
          contextJson: JSON.stringify(ctx),
        });
        notifyUiRuns();
        return;
      }

      if (
        ctx.lastOutcome == null
        && node.type !== 'if'
        && node.type !== 'case'
        && node.type !== 'condition'
      ) {
        setLastOutcome(ctx, 'ok', true);
      }

      const handle = ctx.__nextHandle !== undefined
        ? String(ctx.__nextHandle)
        : 'out';
      delete ctx.__nextHandle;
      queue.push(...nextNodes(graph, node.id, handle));
    }

    const status = finalizeRunStatus(ctx);
    // Limpar dedup de run_flow deste run
    for (const key of [...runFlowOnceKeys]) {
      if (key.startsWith(`${runId}:`)) runFlowOnceKeys.delete(key);
    }
    runsRepo.update(runId, {
      status,
      finishedAt: new Date(),
      currentNodeId: null,
      contextJson: JSON.stringify(ctx),
    });
    await audit({
      actor: 'system',
      action: status === 'success' ? 'flow_run.success' : `flow_run.${status}`,
      entity: 'flow_run',
      entityId: runId,
      flowRunId: runId,
      payload: { outcome: status },
    });
    notifyUiRuns();
  } catch (e) {
    logger.error('advanceRun error', { runId, err: e });
    for (const key of [...runFlowOnceKeys]) {
      if (key.startsWith(`${runId}:`)) runFlowOnceKeys.delete(key);
    }
    runsRepo.update(runId, {
        status: 'failed',
        finishedAt: new Date(),
        currentNodeId: null,
        summary: e instanceof Error ? e.message : String(e),
      });
    notifyUiRuns();
  }
}

// When agent comes online, resume pending runs that need that agent
agentGateway.on('agentOnline', () => {
  const pending = runsRepo.byStatus(['resume_pending']);
  for (const run of pending) {
    void advanceRun(run.id, { resumeInterrupted: true });
  }
});
