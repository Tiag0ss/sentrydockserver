import { flowsRepo } from '../repositories/flowsRepo';
import {
  runsRepo,
  auditRepo,
  watchesRepo,
  policiesRepo,
  updateEventsRepo,
  templatesRepo,
  webhooksRepo,
  settingsRepo,
} from '../repositories/domainRepo';
import { agentsRepo } from '../repositories/agentsRepo';
import { v4 as uuid } from 'uuid';
import { hashToken, randomToken } from './crypto';
import { audit } from './audit';
import { startFlowRun, userContinueRun } from './flowEngine';
import { nextCronDate } from './cronUtils';
import { runPolicyCheck } from './updateEngine';
import { agentGateway } from './agentGateway';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';
import { unreadNotificationCount } from './notificationsService';

function flowNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of flowsRepo.list()) map.set(f.id, f.name);
  return map;
}

function enrichRun<T extends { id: string; flowId: string; contextJson?: string | null }>(
  r: T,
  names: Map<string, string>,
) {
  return {
    ...r,
    flowName: names.get(r.flowId) || r.flowId.slice(0, 8),
    context: r.contextJson ? JSON.parse(r.contextJson) : null,
  };
}

export function listRuns(status?: string) {
  const names = flowNameMap();
  return runsRepo.list(status).map((r) => enrichRun(r, names));
}

export function getRun(id: string) {
  const run = runsRepo.findById(id);
  if (!run) throw new AppError(404, 'not found', 'not_found');
  const flow = flowsRepo.findById(run.flowId);
  const graph = flow?.graphJson
    ? JSON.parse(flow.graphJson) as {
      nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }>;
      edges: unknown[];
    }
    : { nodes: [], edges: [] };

  const agentNames = new Map(agentsRepo.list().map((a) => [a.id, a.name]));
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  const steps = runsRepo.steps(run.id)
    .slice()
    .sort((a, b) => {
      const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return ta - tb;
    })
    .map((s) => {
      const node = nodeById.get(s.nodeId);
      const nodeType = String(node?.type || node?.data?.nodeType || s.nodeId.split('-')[0] || 'node');
      const customLabel = node?.data?.label != null ? String(node.data.label) : null;
      return {
        ...s,
        nodeType,
        label: customLabel && customLabel.trim() ? customLabel : nodeType,
        lastError: humanizeAgentIds(s.lastError, agentNames),
      };
    });

  // Collapse duplicate steps per node (keep worst / latest meaningful status)
  const statusByNode: Record<string, { status: string; attempts: number; lastError: string | null }> = {};
  for (const s of steps) {
    const prev = statusByNode[s.nodeId];
    const rank = stepRank(s.status);
    if (!prev || rank >= stepRank(prev.status)) {
      statusByNode[s.nodeId] = {
        status: s.status,
        attempts: s.attempts,
        lastError: s.lastError,
      };
    }
  }

  const branches = runsRepo.branches(run.id).map((b) => ({
    ...b,
    agentName: b.agentId ? (agentNames.get(b.agentId) || b.agentId.slice(0, 8)) : null,
  }));

  return {
    ...run,
    context: run.contextJson ? JSON.parse(run.contextJson) : null,
    steps,
    branches,
    flow: flow
      ? { id: flow.id, name: flow.name, graph }
      : null,
    nodeStatuses: statusByNode,
  };
}

function humanizeAgentIds(message: string | null, agentNames: Map<string, string>): string | null {
  if (!message) return null;
  return message.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    (id) => {
      const name = agentNames.get(id);
      return name ? name : `${id.slice(0, 8)}…`;
    },
  );
}

function stepRank(status: string): number {
  switch (status) {
    case 'failed': return 50;
    case 'rejected': return 45;
    case 'interrupted': return 40;
    case 'running': return 30;
    case 'success': return 20;
    default: return 10;
  }
}

export async function continueRun(id: string, input: { continue: boolean; branchIds?: string[] }) {
  try {
    await userContinueRun(id, input);
  } catch (err) {
    logger.warn('continue run failed', { id, err: err instanceof Error ? err.message : String(err) });
    throw new AppError(400, 'cannot continue run', 'invalid_run_state');
  }
}

const RERUN_STRIP_KEYS = new Set([
  '__nextHandle',
  '__runOutcome',
  'error',
  'lastError',
  'failedNodeId',
  'failedNodeType',
  'approvalDecision',
  'runId',
  'flowId',
  'selectedBranchIds',
  'branchResults',
  'updateAvailable',
  'oldDigest',
  'newDigest',
  'previousDigest',
]);

function contextForRerun(raw: Record<string, unknown> | null): Record<string, unknown> {
  if (!raw) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (RERUN_STRIP_KEYS.has(k)) continue;
    if (k.startsWith('__')) continue;
    out[k] = v;
  }
  return out;
}

export async function rerunRun(id: string, actor: string, opts?: { dryRun?: boolean }) {
  const run = runsRepo.findById(id);
  if (!run) throw new AppError(404, 'not found', 'not_found');
  const flow = flowsRepo.findById(run.flowId);
  if (!flow) throw new AppError(404, 'flow not found', 'not_found');

  const prevCtx = run.contextJson ? JSON.parse(run.contextJson) as Record<string, unknown> : {};
  const context = contextForRerun(prevCtx);
  const dryRun = opts?.dryRun !== undefined ? Boolean(opts.dryRun) : Boolean(run.dryRun);

  try {
    const runId = await startFlowRun({
      flowId: run.flowId,
      triggerSource: 'rerun',
      context,
      dryRun,
      actor,
      lockKey: run.lockKey || `flow:${run.flowId}`,
    });
    await audit({
      actor,
      action: 'flow_run.rerun',
      entity: 'flow_run',
      entityId: runId,
      flowRunId: runId,
      payload: { fromRunId: id, dryRun },
    });
    return { runId };
  } catch (err) {
    logger.warn('rerun rejected', { id, err: err instanceof Error ? err.message : String(err) });
    throw new AppError(409, 'could not start flow run', 'run_conflict');
  }
}

export function listWatches() {
  return watchesRepo.list();
}

export function createWatch(input: {
  agentId: string;
  containerName: string;
  image: string;
  secretId?: string | null;
}) {
  const id = uuid();
  watchesRepo.insert({
    id,
    agentId: input.agentId,
    containerName: input.containerName,
    image: input.image,
    secretId: input.secretId || null,
    createdAt: new Date(),
  });
  return { id };
}

export function listPolicies() {
  return policiesRepo.list();
}

export function createPolicy(input: {
  name?: string;
  watchId: string;
  flowId: string;
  cron?: string;
  timezone?: string;
  mode?: string;
  blackoutStart?: string | null;
  blackoutEnd?: string | null;
  enabled?: boolean;
}) {
  const id = uuid();
  const tz = input.timezone || 'Europe/Lisbon';
  const cronExpr = input.cron || '0 */6 * * *';
  policiesRepo.insert({
    id,
    name: String(input.name || 'Policy'),
    watchId: input.watchId,
    flowId: input.flowId,
    cron: cronExpr,
    timezone: tz,
    mode: input.mode === 'auto' ? 'auto' : 'notify',
    enabled: input.enabled !== false,
    blackoutStart: input.blackoutStart || null,
    blackoutEnd: input.blackoutEnd || null,
    nextRunAt: nextCronDate(cronExpr, tz),
    createdAt: new Date(),
  });
  return { id };
}

export async function checkPolicy(id: string) {
  try {
    return await runPolicyCheck(id);
  } catch (err) {
    logger.warn('policy check failed', { id, err: err instanceof Error ? err.message : String(err) });
    throw new AppError(502, 'policy check failed', 'policy_check_failed');
  }
}

export function listUpdateEvents() {
  return updateEventsRepo.list();
}

export async function approveUpdateEvent(id: string, actor: string) {
  const ev = updateEventsRepo.findById(id);
  if (!ev || ev.status !== 'pending') throw new AppError(400, 'invalid event', 'invalid_event');
  const policy = policiesRepo.findById(ev.policyId);
  const watch = watchesRepo.findById(ev.watchId);
  if (!policy || !watch) throw new AppError(404, 'missing policy/watch', 'not_found');
  const runId = await startFlowRun({
    flowId: policy.flowId,
    triggerSource: 'manual',
    lockKey: `watch:${watch.id}`,
    actor,
    context: {
      agentId: watch.agentId,
      containerName: watch.containerName,
      image: watch.image,
      secretId: watch.secretId,
      oldDigest: ev.oldDigest,
      newDigest: ev.newDigest,
      updateAvailable: true,
    },
  });
  updateEventsRepo.update(ev.id, { status: 'approved', resolvedAt: new Date() });
  return { runId };
}

export function listTemplates() {
  return templatesRepo.list();
}

export function createTemplate(input: { key: string; name: string; body: string }) {
  const id = uuid();
  templatesRepo.insert({
    id,
    key: input.key,
    name: input.name,
    body: input.body,
    builtin: false,
    createdAt: new Date(),
  });
  return { id };
}

export function listWebhookTriggers() {
  return webhooksRepo.listMeta();
}

export function createWebhookTrigger(input: { name?: string; flowId: string; agentId?: string | null }) {
  const token = randomToken(24);
  const id = uuid();
  webhooksRepo.insert({
    id,
    name: String(input.name || 'Hook'),
    flowId: input.flowId,
    tokenHash: hashToken(token),
    agentId: input.agentId || null,
    enabled: true,
    createdAt: new Date(),
  });
  return { id, token, url: `/api/hooks/${id}` };
}

export async function handleInboundWebhook(
  id: string,
  token: string,
  body: Record<string, unknown>,
) {
  const trigger = webhooksRepo.findById(id);
  if (!trigger || !trigger.enabled) throw new AppError(404, 'not found', 'not_found');
  if (!token || hashToken(token) !== trigger.tokenHash) {
    throw new AppError(401, 'unauthorized', 'unauthorized');
  }
  try {
    const runId = await startFlowRun({
      flowId: trigger.flowId,
      triggerSource: 'webhook',
      actor: 'webhook',
      context: {
        ...body,
        agentId: trigger.agentId || body.agentId,
      },
    });
    await audit({
      actor: 'webhook',
      action: 'webhook.inbound',
      entity: 'webhook_trigger',
      entityId: trigger.id,
      flowRunId: runId,
    });
    return { runId };
  } catch (err) {
    logger.warn('inbound webhook run failed', { id, err: err instanceof Error ? err.message : String(err) });
    throw new AppError(409, 'could not start flow run', 'run_conflict');
  }
}

export function listLogs(limit: number, flowRunId?: string) {
  return auditRepo.list(limit, flowRunId).map((r) => ({
    ...r,
    payload: r.payloadJson ? JSON.parse(r.payloadJson) : null,
  }));
}

export {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from './notificationsService';

export { unreadNotificationCount };

export function getDashboard() {
  const names = flowNameMap();
  const active = runsRepo.active();
  const history = runsRepo.list('history').slice(0, 20);
  const upcoming = policiesRepo.listEnabled()
    .filter((p) => p.nextRunAt)
    .sort((a, b) => (a.nextRunAt!.getTime() - b.nextRunAt!.getTime()))
    .slice(0, 20);
  const agentRows = agentsRepo.list();
  const pendingUpdates = updateEventsRepo.listPending();
  const awaiting = active.filter((r) => r.status === 'awaiting_user' || r.status === 'waiting_approval');

  return {
    activeRuns: active.map((r) => enrichRun(r, names)),
    upcomingPolicies: upcoming,
    history: history.map((r) => enrichRun(r, names)),
    agents: agentRows.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      online: agentGateway.isOnline(a.id),
      meta: a.metaJson ? JSON.parse(a.metaJson) : null,
    })),
    pendingUpdates,
    attention: awaiting.map((r) => enrichRun(r, names)),
    summary: {
      agentsOnline: agentRows.filter((a) => agentGateway.isOnline(a.id)).length,
      activeRuns: active.length,
      pendingUpdates: pendingUpdates.length,
      unreadNotifications: unreadNotificationCount(),
    },
  };
}

export function listSettings() {
  return settingsRepo.list();
}

export function updateSetting(key: string, value: string) {
  settingsRepo.upsert(key, value);
}
