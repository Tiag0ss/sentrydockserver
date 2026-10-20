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
import { updateAgentMeta } from './agentsService';
import { getAgentMetrics, parseMetricsConfig } from './metricsService';

function flowNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of flowsRepo.list()) map.set(f.id, f.name);
  return map;
}

function enrichRun<T extends {
  id: string;
  flowId: string;
  currentNodeId?: string | null;
  contextJson?: string | null;
}>(r: T, names: Map<string, string>, graphs?: Map<string, { nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }> }>) {
  const graph = graphs?.get(r.flowId);
  const node = r.currentNodeId && graph
    ? graph.nodes.find((n) => n.id === r.currentNodeId)
    : undefined;
  const currentNodeType = node
    ? String(node.type || node.data?.nodeType || '')
    : (r.currentNodeId ? inferNodeTypeFromId(r.currentNodeId) : null);
  const currentNodeLabel = (() => {
    const custom = node?.data?.label != null ? String(node.data.label).trim() : '';
    if (custom) return custom;
    return currentNodeType || null;
  })();

  return {
    ...r,
    flowName: names.get(r.flowId) || r.flowId.slice(0, 8),
    context: r.contextJson ? JSON.parse(r.contextJson) : null,
    currentNodeType: currentNodeType || null,
    currentNodeLabel,
  };
}

function inferNodeTypeFromId(nodeId: string): string | null {
  const m = nodeId.match(/^([a-z][a-z0-9_]*)-/i);
  return m ? m[1] : null;
}

function flowGraphMap(): Map<string, { nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }> }> {
  const map = new Map<string, { nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }> }>();
  for (const f of flowsRepo.list()) {
    try {
      map.set(f.id, JSON.parse(f.graphJson));
    } catch {
      map.set(f.id, { nodes: [] });
    }
  }
  return map;
}

export function listRuns(status?: string) {
  const names = flowNameMap();
  const graphs = flowGraphMap();
  return runsRepo.list(status).map((r) => enrichRun(r, names, graphs));
}

export type ListRunsQuery = {
  status?: string;
  q?: string;
  flowId?: string;
  runStatus?: string;
  trigger?: string;
  dryRun?: string;
  topLevelOnly?: string;
  page?: string | number;
  pageSize?: string | number;
};

export function listRunsPaged(query: ListRunsQuery = {}) {
  const names = flowNameMap();
  const graphs = flowGraphMap();

  const bucketRaw = String(query.status || '').trim();
  const bucket: 'active' | 'history' | 'all' =
    bucketRaw === 'active' || bucketRaw === 'history' ? bucketRaw : 'all';

  let dryRun: boolean | null = null;
  if (query.dryRun === '1' || query.dryRun === 'true') dryRun = true;
  else if (query.dryRun === '0' || query.dryRun === 'false') dryRun = false;

  const result = runsRepo.query({
    bucket,
    status: query.runStatus?.trim() || undefined,
    flowId: query.flowId?.trim() || undefined,
    trigger: query.trigger?.trim() || undefined,
    q: query.q?.trim() || undefined,
    dryRun,
    topLevelOnly: query.topLevelOnly === '1' || query.topLevelOnly === 'true',
    page: Number(query.page || 1),
    pageSize: Number(query.pageSize || (bucket === 'active' ? 100 : 20)),
  });

  const facetsRaw = runsRepo.facets(bucket === 'all' ? 'history' : bucket);
  const flows = facetsRaw.flowIds
    .map((id) => ({ id, name: names.get(id) || id.slice(0, 8) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    items: result.items.map((r) => enrichRun(r, names, graphs)),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    facets: {
      flows,
      statuses: facetsRaw.statuses,
      triggers: facetsRaw.triggers,
    },
  };
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
  const runContext = run.contextJson ? JSON.parse(run.contextJson) as Record<string, unknown> : null;

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
      let detail = parseStepDetail(s.detailJson);
      if (!detail) detail = fallbackStepDetail(nodeType, runContext);
      if (detail?.agentId && typeof detail.agentId === 'string') {
        detail = {
          ...detail,
          agentName: agentNames.get(detail.agentId) || detail.agentId.slice(0, 8),
        };
      }
      return {
        ...s,
        detailJson: undefined,
        detail,
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

  const names = flowNameMap();
  const parentRow = run.parentRunId ? runsRepo.findById(run.parentRunId) : null;
  const children = runsRepo.childrenOf(run.id)
    .filter((c) => c.triggerSource !== 'lock')
    .map((c) => ({
      id: c.id,
      flowId: c.flowId,
      flowName: names.get(c.flowId) || c.flowId.slice(0, 8),
      status: c.status,
      parentStepId: c.parentStepId,
      startedAt: c.startedAt,
      finishedAt: c.finishedAt,
    }));

  return {
    ...run,
    context: runContext,
    steps,
    branches,
    parentRunId: run.parentRunId || null,
    parentStepId: run.parentStepId || null,
    parent: parentRow
      ? {
        id: parentRow.id,
        flowId: parentRow.flowId,
        flowName: names.get(parentRow.flowId) || parentRow.flowId.slice(0, 8),
        status: parentRow.status,
      }
      : null,
    children,
    flow: flow
      ? { id: flow.id, name: flow.name, graph }
      : null,
    nodeStatuses: statusByNode,
  };
}

function parseStepDetail(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** Older runs have no detail_json — reconstruct useful fields from run context. */
function fallbackStepDetail(
  nodeType: string,
  ctx: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!ctx) return null;
  const base: Record<string, unknown> = {};
  if (ctx.image) base.image = ctx.image;
  if (ctx.containerName) base.containerName = ctx.containerName;
  if (ctx.agentId) base.agentId = ctx.agentId;
  if (ctx.oldDigest) base.oldDigest = ctx.oldDigest;
  if (ctx.newDigest) base.newDigest = ctx.newDigest;
  if (ctx.previousDigest) base.previousDigest = ctx.previousDigest;
  if (ctx.updateAvailable != null) {
    base.updateAvailable = Boolean(ctx.updateAvailable);
    base.reason = ctx.updateAvailable ? 'digest_mismatch' : 'up_to_date';
  }
  if (Object.keys(base).length === 0) return null;

  const relevant = new Set([
    'check_image_update',
    'pull_image',
    'recreate_container',
    'wait_approval',
    'condition',
    'wait_healthy',
    'rollback',
  ]);
  if (!relevant.has(nodeType)) return null;
  return base;
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

export async function continueRun(id: string, input: {
  continue: boolean;
  branchIds?: string[];
  targetTag?: string;
  targetRange?: string;
  targetMode?: string;
}) {
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
  // Re-run is a real execution by default — do not inherit dry-run from the previous run.
  const dryRun = opts?.dryRun !== undefined ? Boolean(opts.dryRun) : false;

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

export function updateWatch(id: string, input: {
  agentId?: string;
  containerName?: string;
  image?: string;
  secretId?: string | null;
}) {
  const existing = watchesRepo.findById(id);
  if (!existing) throw new AppError(404, 'watch not found', 'not_found');
  watchesRepo.update(id, {
    ...(input.agentId != null ? { agentId: input.agentId } : {}),
    ...(input.containerName != null ? { containerName: input.containerName } : {}),
    ...(input.image != null ? { image: input.image } : {}),
    ...(input.secretId !== undefined ? { secretId: input.secretId } : {}),
  });
  return { id };
}

export function deleteWatch(id: string) {
  const existing = watchesRepo.findById(id);
  if (!existing) throw new AppError(404, 'watch not found', 'not_found');
  const linked = policiesRepo.list().filter((p) => p.watchId === id);
  if (linked.length) {
    throw new AppError(400, 'watch has policies; delete them first', 'watch_in_use');
  }
  watchesRepo.delete(id);
  return { ok: true };
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

export function updatePolicy(id: string, input: {
  name?: string;
  watchId?: string;
  flowId?: string;
  cron?: string;
  timezone?: string;
  mode?: string;
  blackoutStart?: string | null;
  blackoutEnd?: string | null;
  enabled?: boolean;
}) {
  const existing = policiesRepo.findById(id);
  if (!existing) throw new AppError(404, 'policy not found', 'not_found');
  const cronExpr = input.cron ?? existing.cron;
  const tz = input.timezone ?? existing.timezone;
  const patch: Parameters<typeof policiesRepo.update>[1] = {};
  if (input.name != null) patch.name = input.name;
  if (input.watchId != null) patch.watchId = input.watchId;
  if (input.flowId != null) patch.flowId = input.flowId;
  if (input.cron != null) patch.cron = input.cron;
  if (input.timezone != null) patch.timezone = input.timezone;
  if (input.mode != null) patch.mode = input.mode === 'auto' ? 'auto' : 'notify';
  if (input.enabled != null) patch.enabled = input.enabled;
  if (input.blackoutStart !== undefined) patch.blackoutStart = input.blackoutStart || null;
  if (input.blackoutEnd !== undefined) patch.blackoutEnd = input.blackoutEnd || null;
  if (input.cron != null || input.timezone != null) {
    patch.nextRunAt = nextCronDate(cronExpr, tz);
  }
  policiesRepo.update(id, patch);
  return { id };
}

export function deletePolicy(id: string) {
  const existing = policiesRepo.findById(id);
  if (!existing) throw new AppError(404, 'policy not found', 'not_found');
  policiesRepo.delete(id);
  return { ok: true };
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

export function updateTemplate(id: string, input: { key?: string; name?: string; body?: string }) {
  const rows = templatesRepo.list();
  const existing = rows.find((r) => r.id === id);
  if (!existing) throw new AppError(404, 'template not found', 'not_found');
  // Integrados: só nome/corpo; chave e apagar ficam bloqueados.
  if (existing.builtin && input.key != null && input.key !== existing.key) {
    throw new AppError(400, 'cannot rename key of builtin template', 'builtin_readonly');
  }
  if (input.key != null && input.key !== existing.key) {
    const clash = templatesRepo.findByKey(input.key);
    if (clash && clash.id !== id) throw new AppError(409, 'key already exists', 'duplicate_key');
  }
  templatesRepo.update(id, {
    ...(input.key != null && !existing.builtin ? { key: input.key } : {}),
    ...(input.name != null ? { name: input.name } : {}),
    ...(input.body != null ? { body: input.body } : {}),
  });
  return { id };
}

export function deleteTemplate(id: string) {
  const rows = templatesRepo.list();
  const existing = rows.find((r) => r.id === id);
  if (!existing) throw new AppError(404, 'template not found', 'not_found');
  if (existing.builtin) throw new AppError(400, 'cannot delete builtin template', 'builtin_readonly');
  templatesRepo.delete(id);
  return { ok: true };
}

export function exportOpsBundle() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    watches: watchesRepo.list().map((w) => ({
      agentId: w.agentId,
      containerName: w.containerName,
      image: w.image,
      secretId: w.secretId,
    })),
    policies: policiesRepo.list().map((p) => ({
      name: p.name,
      watchId: p.watchId,
      flowId: p.flowId,
      cron: p.cron,
      timezone: p.timezone,
      mode: p.mode,
      enabled: p.enabled,
      blackoutStart: p.blackoutStart,
      blackoutEnd: p.blackoutEnd,
    })),
    templates: templatesRepo.list()
      .filter((t) => !t.builtin)
      .map((t) => ({ key: t.key, name: t.name, body: t.body })),
  };
}

export function importOpsBundle(input: {
  watches?: Array<{ agentId: string; containerName: string; image: string; secretId?: string | null }>;
  policies?: Array<{
    name?: string;
    watchId: string;
    flowId: string;
    cron?: string;
    timezone?: string;
    mode?: string;
    enabled?: boolean;
    blackoutStart?: string | null;
    blackoutEnd?: string | null;
  }>;
  templates?: Array<{ key: string; name: string; body: string }>;
}) {
  const created = { watches: 0, policies: 0, templates: 0 };
  for (const w of input.watches || []) {
    createWatch(w);
    created.watches += 1;
  }
  for (const p of input.policies || []) {
    createPolicy(p);
    created.policies += 1;
  }
  for (const t of input.templates || []) {
    const existing = templatesRepo.findByKey(t.key);
    if (existing) {
      if (!existing.builtin) {
        templatesRepo.update(existing.id, { name: t.name, body: t.body });
      }
    } else {
      createTemplate(t);
      created.templates += 1;
    }
  }
  return created;
}

export function updateAgentLabels(id: string, labels: string[]) {
  return updateAgentMeta(id, { labels });
}

export function listWebhookTriggers() {
  const names = flowNameMap();
  return webhooksRepo.listMeta().map((h) => ({
    ...h,
    flowName: names.get(h.flowId) || null,
    url: `/api/hooks/${h.id}`,
  }));
}

export function createWebhookTrigger(input: { name?: string; flowId: string; agentId?: string | null }) {
  const flow = flowsRepo.findById(input.flowId);
  if (!flow) throw new AppError(400, 'flow not found', 'flow_not_found');
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

export function updateWebhookTrigger(
  id: string,
  input: { name?: string; flowId?: string; enabled?: boolean; agentId?: string | null },
) {
  const existing = webhooksRepo.findById(id);
  if (!existing) throw new AppError(404, 'not found', 'not_found');
  const patch: Parameters<typeof webhooksRepo.update>[1] = {};
  if (input.name != null) patch.name = String(input.name).trim() || existing.name;
  if (input.flowId != null) {
    const flow = flowsRepo.findById(input.flowId);
    if (!flow) throw new AppError(400, 'flow not found', 'flow_not_found');
    patch.flowId = input.flowId;
  }
  if (input.enabled != null) patch.enabled = Boolean(input.enabled);
  if (input.agentId !== undefined) patch.agentId = input.agentId;
  webhooksRepo.update(id, patch);
  const row = webhooksRepo.findById(id)!;
  return {
    id: row.id,
    name: row.name,
    flowId: row.flowId,
    flowName: flowsRepo.findById(row.flowId)?.name || null,
    agentId: row.agentId,
    enabled: row.enabled,
    url: `/api/hooks/${row.id}`,
  };
}

export function resetWebhookTriggerToken(id: string) {
  const existing = webhooksRepo.findById(id);
  if (!existing) throw new AppError(404, 'not found', 'not_found');
  const token = randomToken(24);
  webhooksRepo.update(id, { tokenHash: hashToken(token) });
  return { id, token, url: `/api/hooks/${id}` };
}

export function deleteWebhookTrigger(id: string) {
  const existing = webhooksRepo.findById(id);
  if (!existing) throw new AppError(404, 'not found', 'not_found');
  webhooksRepo.delete(id);
  return { ok: true };
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

export function listLogs(opts: {
  limit?: number;
  flowRunId?: string;
  action?: string;
  actor?: string;
  entity?: string;
  q?: string;
} | number = 100, flowRunIdLegacy?: string) {
  // Compat: listLogs(limit, flowRunId)
  const params = typeof opts === 'number'
    ? { limit: opts, flowRunId: flowRunIdLegacy }
    : opts;
  const limit = Math.min(Math.max(Number(params.limit || 100), 1), 500);
  const rows = auditRepo.list({
    limit,
    flowRunId: params.flowRunId || undefined,
    action: params.action || undefined,
    actor: params.actor || undefined,
    entity: params.entity || undefined,
    q: params.q?.trim() || undefined,
  });

  const runIds = [...new Set(rows.map((r) => r.flowRunId).filter(Boolean))] as string[];
  const flowByRun = new Map<string, { flowId: string; flowName: string }>();
  for (const runId of runIds) {
    const run = runsRepo.findById(runId);
    if (!run) continue;
    const flow = flowsRepo.findById(run.flowId);
    flowByRun.set(runId, {
      flowId: run.flowId,
      flowName: flow?.name || run.flowId.slice(0, 8),
    });
  }

  const items = rows.map((r) => {
    const payload = r.payloadJson ? (() => {
      try { return JSON.parse(r.payloadJson!); } catch { return null; }
    })() : null;
    const flowMeta = r.flowRunId ? flowByRun.get(r.flowRunId) : null;
    return {
      id: r.id,
      ts: r.ts,
      actor: r.actor,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      flowRunId: r.flowRunId,
      flowId: flowMeta?.flowId ?? null,
      flowName: flowMeta?.flowName ?? null,
      payload,
      summary: summarizeAuditPayload(r.action, payload),
      level: auditLevel(r.action),
    };
  });

  return {
    items,
    facets: auditRepo.facets(),
  };
}

function auditLevel(action: string): 'ok' | 'warn' | 'danger' | 'info' {
  if (/fail|error|reject|abort|delete/i.test(action)) return 'danger';
  if (/interrupt|blackout|offline|waiting|approval|warn/i.test(action)) return 'warn';
  if (/success|online|created|approved|notify/i.test(action)) return 'ok';
  return 'info';
}

function summarizeAuditPayload(action: string, payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof p.message === 'string' && p.message.trim()) bits.push(p.message.trim().slice(0, 160));
  if (typeof p.type === 'string') bits.push(p.type);
  if (typeof p.branch === 'string') bits.push(`→ ${p.branch}`);
  if (typeof p.outcome === 'string') bits.push(p.outcome);
  if (typeof p.agentName === 'string') bits.push(p.agentName);
  if (typeof p.hostname === 'string') bits.push(p.hostname);
  if (typeof p.error === 'string') bits.push(p.error.slice(0, 120));
  if (typeof p.level === 'string' && action === 'notify') bits.push(p.level);
  if (p.dryRun === true) bits.push('dry-run');
  if (typeof p.attempts === 'number' && p.attempts > 1) bits.push(`×${p.attempts}`);
  return bits.length ? bits.join(' · ') : null;
}

export {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from './notificationsService';

export { unreadNotificationCount };

export function getDashboard() {
  const names = flowNameMap();
  const graphs = flowGraphMap();
  const active = runsRepo.active();
  const history = runsRepo.list('history').slice(0, 200);
  const upcoming = flowsRepo.listScheduled()
    .filter((f) => f.nextRunAt)
    .sort((a, b) => (a.nextRunAt!.getTime() - b.nextRunAt!.getTime()))
    .slice(0, 20)
    .map((f) => ({
      id: f.id,
      name: f.name,
      nextRunAt: f.nextRunAt!,
      cron: f.cron || '',
      timezone: f.timezone || 'Europe/Lisbon',
    }));
  const agentRows = agentsRepo.list();
  const pendingUpdates = updateEventsRepo.listPending();

  const awaiting = active.filter((r) => r.status === 'awaiting_user' || r.status === 'waiting_approval');
  const executing = active.filter((r) => r.status !== 'awaiting_user' && r.status !== 'waiting_approval');

  return {
    activeRuns: executing.map((r) => enrichRun(r, names, graphs)),
    upcomingPolicies: upcoming
      .map((f) => ({
        id: f.id,
        name: f.name,
        nextRunAt: f.nextRunAt,
        cron: f.cron,
        timezone: f.timezone,
      })),
    history: history.map((r) => enrichRun(r, names, graphs)),
    agents: agentRows.map((a) => {
      let meta: Record<string, unknown> | null = null;
      try {
        meta = a.metaJson ? JSON.parse(a.metaJson) : null;
      } catch {
        meta = null;
      }
      const metricsCfg = parseMetricsConfig(meta);
      const metrics = getAgentMetrics(a.id, {
        from: Date.now() - Math.min(6 * 3600_000, metricsCfg.metricsRetentionHours * 3600_000),
      });
      return {
        id: a.id,
        name: a.name,
        status: a.status,
        online: agentGateway.isOnline(a.id),
        hostname: a.hostname,
        transport: a.transport,
        protocolVersion: a.protocolVersion,
        meta,
        labels: Array.isArray(meta?.labels) ? meta!.labels as string[] : [],
        inventory: meta ? {
          diskUsedBytes: typeof meta.diskUsedBytes === 'number' ? meta.diskUsedBytes : null,
          diskTotalBytes: typeof meta.diskTotalBytes === 'number' ? meta.diskTotalBytes : null,
          danglingImages: typeof meta.danglingImages === 'number' ? meta.danglingImages : null,
          containers: typeof meta.containers === 'number' ? meta.containers : null,
        } : null,
        metricsIntervalSec: metricsCfg.metricsIntervalSec,
        metricsRetentionHours: metricsCfg.metricsRetentionHours,
        containerMetrics: metrics.containers,
      };
    }),
    inventoryAlerts: agentRows.flatMap((a) => {
      let meta: Record<string, unknown> = {};
      try {
        meta = a.metaJson ? JSON.parse(a.metaJson) : {};
      } catch {
        meta = {};
      }
      const alerts: Array<{ agentId: string; agentName: string; kind: string; message: string }> = [];
      const dangling = typeof meta.danglingImages === 'number' ? meta.danglingImages : 0;
      if (dangling >= 5) {
        alerts.push({
          agentId: a.id,
          agentName: a.name,
          kind: 'dangling',
          message: `${dangling} dangling images`,
        });
      }
      const used = typeof meta.diskUsedBytes === 'number' ? meta.diskUsedBytes : null;
      const total = typeof meta.diskTotalBytes === 'number' ? meta.diskTotalBytes : null;
      if (used != null && total != null && total > 0 && used / total >= 0.85) {
        alerts.push({
          agentId: a.id,
          agentName: a.name,
          kind: 'disk',
          message: `disk ${Math.round((used / total) * 100)}% used`,
        });
      }
      return alerts;
    }),
    pendingUpdates,
    attention: awaiting.map((r) => enrichRun(r, names, graphs)),
    summary: {
      agentsOnline: agentRows.filter((a) => agentGateway.isOnline(a.id)).length,
      activeRuns: executing.length,
      pendingUpdates: pendingUpdates.length,
      awaitingApproval: awaiting.length,
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
