import { v4 as uuid } from 'uuid';
import { flowsRepo } from '../repositories/flowsRepo';
import { runsRepo } from '../repositories/domainRepo';
import { agentGateway } from './agentGateway';
import { audit } from './audit';
import { getSecretPlain } from './secretsService';
import logger from '../utils/logger';

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

function parseGraph(json: string): FlowGraph {
  return JSON.parse(json) as FlowGraph;
}

function getRetries(node: FlowNode): number {
  const r = Number(node.data?.retries ?? 0);
  return Number.isFinite(r) ? Math.max(0, r) : 0;
}

function renderTemplate(body: string, ctx: RunContext): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const v = ctx[key];
    return v == null ? '' : String(v);
  });
}

export function acquireLock(lockKey: string): boolean {
  return runsRepo.activeByLock(lockKey).length === 0;
}

export async function startFlowRun(opts: {
  flowId: string;
  triggerSource: string;
  context?: RunContext;
  lockKey?: string;
  dryRun?: boolean;
  actor?: string;
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
    });

  await audit({
    actor: opts.actor || 'system',
    action: 'flow_run.started',
    entity: 'flow_run',
    entityId: runId,
    flowRunId: runId,
    payload: { dryRun: opts.dryRun, triggerSource: opts.triggerSource },
  });

  void advanceRun(runId);
  return runId;
}

function entryNodes(graph: FlowGraph): FlowNode[] {
  const targets = new Set(graph.edges.map((e) => e.target));
  return graph.nodes.filter((n) => !targets.has(n.id) && n.type !== 'join');
}

function nextNodes(graph: FlowGraph, nodeId: string, handle?: string): FlowNode[] {
  const source = graph.nodes.find((n) => n.id === nodeId);
  const from = graph.edges.filter((e) => e.source === nodeId);
  const wanted = handle !== undefined
    ? normalizeHandleId(source?.type || '', handle)
    : 'ok';
  const edges = from.filter((e) => normalizeHandleId(source?.type || '', e.sourceHandle) === wanted);
  return edges
    .map((e) => graph.nodes.find((n) => n.id === e.target))
    .filter(Boolean) as FlowNode[];
}

function normalizeHandleId(type: string, handle: string | null | undefined): string {
  if (handle === 'out' || handle === 'success' || !handle) {
    if (type === 'check_image_update') return 'update'; // shouldn't default here for branching
    return 'ok';
  }
  return handle;
}

async function upsertStep(runId: string, nodeId: string, branchId: string | null, status: string, patch: Partial<{
  attempts: number;
  lastError: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
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
    });
  return id;
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

export async function userContinueRun(runId: string, opts: { continue: boolean; branchIds?: string[] }) {
  const run = runsRepo.findById(runId);
  if (!run) throw new Error('Run not found');
  if (run.status !== 'awaiting_user' && run.status !== 'waiting_approval') {
    throw new Error('Run is not awaiting user');
  }
  const ctx = JSON.parse(run.contextJson || '{}') as RunContext;
  if (opts.branchIds) ctx.selectedBranchIds = opts.branchIds;

  if (run.status === 'waiting_approval') {
    const decision = opts.continue ? 'approved' : 'rejected';
    ctx.__nextHandle = decision;
    ctx.approvalDecision = decision;
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
    return;
  }
  runsRepo.update(runId, { status: 'running', contextJson: JSON.stringify(ctx) });
  void advanceRun(runId, { afterUserContinue: true });
}

async function getRegistryAuth(secretId?: string | null) {
  if (!secretId) return undefined;
  const plainStr = getSecretPlain(secretId);
  if (!plainStr) return undefined;
  try {
    return JSON.parse(plainStr) as { username: string; password: string; serveraddress?: string };
  } catch (err) {
    logger.warn('invalid registry secret JSON', { secretId });
    return undefined;
  }
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
        await upsertStep(runId, node.id, branchId, 'success', { finishedAt: new Date() });
        return 'success';
      }

      switch (node.type) {
        case 'check_image_update': {
          const agentId = String(node.data.agentId || ctx.agentId || '');
          const image = String(node.data.image || ctx.image || '');
          const containerName = String(node.data.containerName || ctx.containerName || '');
          const auth = await getRegistryAuth(String(node.data.secretId || ctx.secretId || '') || null);
          const local = await agentGateway.sendCommand(agentId, 'docker.inspect', { id: containerName }) as {
            Image?: string;
            Config?: { Image?: string };
          };
          const remote = await agentGateway.sendCommand(agentId, 'image.digest', { image, auth }) as {
            digest?: string;
          };
          const localDigest = String((local as { Id?: string }).Id || '');
          const updateAvailable = Boolean(remote.digest && localDigest && !localDigest.includes(remote.digest.replace('sha256:', '')));
          Object.assign(ctx, {
            updateAvailable,
            oldDigest: localDigest,
            newDigest: remote.digest,
            image,
            agentId,
            containerName,
            __nextHandle: updateAvailable ? 'update' : 'no_update',
          });
          break;
        }
        case 'pull_image': {
          const agentId = String(node.data.agentId || ctx.agentId || '');
          const image = String(node.data.image || ctx.image || '');
          const auth = await getRegistryAuth(String(node.data.secretId || ctx.secretId || '') || null);
          // save previous digest for rollback
          if (ctx.containerName) {
            try {
              const insp = await agentGateway.sendCommand(agentId, 'docker.inspect', { id: ctx.containerName }) as { Image?: string };
              ctx.previousDigest = insp.Image;
            } catch (err) {
              logger.warn('could not inspect container for previous digest', {
                err: err instanceof Error ? err.message : String(err),
              });
            }
          }
          await agentGateway.sendCommand(agentId, 'docker.pull', { image, auth });
          break;
        }
        case 'recreate_container': {
          const agentId = String(node.data.agentId || ctx.agentId || '');
          const id = String(node.data.containerName || ctx.containerName || '');
          const image = String(node.data.image || ctx.image || '');
          const desiredDigest = ctx.newDigest ? String(ctx.newDigest) : undefined;
          await agentGateway.sendCommand(agentId, 'docker.recreate', { id, image, desiredDigest });
          break;
        }
        case 'compose_up':
        case 'compose_down': {
          const agentId = String(node.data.agentId || ctx.agentId || '');
          await agentGateway.sendCommand(agentId, 'docker.compose', {
            action: node.type === 'compose_up' ? 'up' : 'down',
            projectPath: String(node.data.projectPath || ''),
          });
          break;
        }
        case 'notify': {
          await audit({
            actor: 'system',
            action: 'notify',
            flowRunId: runId,
            payload: { message: node.data.message || 'notify', ctx },
          });
          break;
        }
        case 'webhook': {
          const url = String(node.data.url || '');
          const method = String(node.data.method || 'POST');
          const templateBody = String(node.data.templateBody || node.data.body || '{}');
          const body = renderTemplate(templateBody, ctx);
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...((node.data.headers as Record<string, string>) || {}),
          };
          const res = await fetch(url, { method, headers, body });
          await audit({
            actor: 'system',
            action: 'webhook.sent',
            flowRunId: runId,
            payload: { url: url.replace(/\/\/.*@/, '//***@'), status: res.status },
          });
          if (!res.ok) throw new Error(`Webhook HTTP ${res.status}`);
          break;
        }
        case 'wait_approval': {
          runsRepo.update(runId, { status: 'waiting_approval' });
          await upsertStep(runId, node.id, branchId, 'running', {});
          return 'waiting';
        }
        case 'condition': {
          const field = String(node.data.field || 'updateAvailable');
          ctx.__nextHandle = ctx[field] ? 'true' : 'false';
          break;
        }
        case 'wait_healthy': {
          const agentId = String(node.data.agentId || ctx.agentId || '');
          const id = String(node.data.containerName || ctx.containerName || '');
          const timeout = Number(node.data.timeoutMs || 60_000);
          const start = Date.now();
          let healthy = false;
          while (Date.now() - start < timeout) {
            const insp = await agentGateway.sendCommand(agentId, 'docker.inspect', { id }) as {
              State?: { Health?: { Status?: string }; Status?: string };
            };
            const health = insp.State?.Health?.Status;
            const status = insp.State?.Status;
            if (health === 'healthy' || (!health && status === 'running')) {
              healthy = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
          ctx.__nextHandle = healthy ? 'healthy' : 'timeout';
          break;
        }
        case 'rollback': {
          const agentId = String(node.data.agentId || ctx.agentId || '');
          const id = String(node.data.containerName || ctx.containerName || '');
          const image = String(ctx.previousDigest || node.data.image || '');
          await agentGateway.sendCommand(agentId, 'docker.recreate', { id, image });
          break;
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
      const handle = String(ctx.__nextHandle || 'ok');
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
        const targets = (node.data.targets as Array<{ agentId: string; containerName?: string; image?: string }>) || [];
        const branchNodes = nextNodes(graph, node.id);
        const joinNode = graph.nodes.find((n) => n.type === 'join' && nextNodes(graph, node.id).some(() => true));
        // Find join reachable from split
        const findJoin = (): FlowNode | undefined => {
          const q = [...branchNodes];
          const seen = new Set<string>();
          while (q.length) {
            const n = q.shift()!;
            if (seen.has(n.id)) continue;
            seen.add(n.id);
            if (n.type === 'join') return n;
            q.push(...nextNodes(graph, n.id));
          }
          return joinNode;
        };
        const join = findJoin();

        const branches = targets.map((t) => {
          const id = uuid();
          runsRepo.insertBranch({
              id,
              runId,
              splitNodeId: node.id,
              agentId: t.agentId,
              containerName: t.containerName || null,
              status: 'running',
              contextJson: JSON.stringify({ ...ctx, ...t }),
            });
          return { id, ...t };
        });

        await Promise.all(branches.map(async (b) => {
          const bctx = { ...ctx, agentId: b.agentId, containerName: b.containerName, image: b.image || ctx.image };
          // execute linear path until join
          let path = branchNodes.filter((n) => n.type !== 'join');
          const localVisited = new Set<string>();
          while (path.length) {
            const n = path.shift()!;
            if (n.type === 'join') break;
            if (localVisited.has(n.id)) continue;
            localVisited.add(n.id);
            const r = await executeNode(runId, n, bctx, b.id, dryRun);
            if (r === 'failed') {
              runsRepo.updateBranch(b.id, { status: 'failed', contextJson: JSON.stringify(bctx) });
              return;
            }
            const h = bctx.__nextHandle ? String(bctx.__nextHandle) : undefined;
            delete bctx.__nextHandle;
            path.push(...nextNodes(graph, n.id, h).filter((x) => x.type !== 'join'));
          }
          runsRepo.updateBranch(b.id, { status: 'success', contextJson: JSON.stringify(bctx) });
        }));

        const allBranches = runsRepo.branchesBySplit(runId, node.id);
        ctx.branchResults = allBranches.map((b) => ({
          branchId: b.id,
          agentId: b.agentId,
          containerName: b.containerName,
          status: b.status,
        }));

        if (join) {
          const mode = String(join.data.mode || 'wait_all');
          if (mode === 'await_user') {
            runsRepo.update(runId, { status: 'awaiting_user', currentNodeId: join.id, contextJson: JSON.stringify(ctx) });
            return;
          }
          if (mode === 'continue_successes') {
            const ok = allBranches.filter((b) => b.status === 'success').map((b) => b.id);
            ctx.selectedBranchIds = ok;
          }
          await upsertStep(runId, join.id, null, 'success', { finishedAt: new Date() });
          queue.push(...nextNodes(graph, join.id));
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
        const errorNext = nextNodes(graph, node.id, 'error');
        if (errorNext.length) {
          queue.push(...errorNext);
          continue;
        }
        runsRepo.update(runId, { status: 'awaiting_user', currentNodeId: node.id, contextJson: JSON.stringify(ctx) });
        return;
      }

      const handle = ctx.__nextHandle !== undefined ? String(ctx.__nextHandle) : 'ok';
      delete ctx.__nextHandle;
      queue.push(...nextNodes(graph, node.id, handle));
    }

    runsRepo.update(runId, {
      status: 'success',
      finishedAt: new Date(),
      currentNodeId: null,
      contextJson: JSON.stringify(ctx),
    });
    await audit({ actor: 'system', action: 'flow_run.success', entity: 'flow_run', entityId: runId, flowRunId: runId });
  } catch (e) {
    logger.error('advanceRun error', { runId, err: e });
    runsRepo.update(runId, {
        status: 'failed',
        finishedAt: new Date(),
        currentNodeId: null,
        summary: e instanceof Error ? e.message : String(e),
      });
  }
}

// When agent comes online, resume pending runs that need that agent
agentGateway.on('agentOnline', () => {
  const pending = runsRepo.byStatus(['resume_pending']);
  for (const run of pending) {
    void advanceRun(run.id, { resumeInterrupted: true });
  }
});
