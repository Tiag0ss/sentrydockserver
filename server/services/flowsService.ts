import { v4 as uuid } from 'uuid';
import { flowsRepo } from '../repositories/flowsRepo';
import { runsRepo } from '../repositories/domainRepo';
import { audit } from './audit';
import { startFlowRun } from './flowEngine';
import { migrateFlowGraph } from './flowGraphMigrate';
import { nextCronDate } from './cronUtils';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

function serializeFlow(f: ReturnType<typeof flowsRepo.findById>) {
  if (!f) return null;
  const graph = migrateFlowGraph(JSON.parse(f.graphJson || '{"nodes":[],"edges":[]}'));
  return {
    id: f.id,
    name: f.name,
    description: f.description,
    graphJson: f.graphJson,
    graph,
    scheduleEnabled: Boolean(f.scheduleEnabled),
    cron: f.cron,
    timezone: f.timezone || 'Europe/Lisbon',
    blackoutStart: f.blackoutStart,
    blackoutEnd: f.blackoutEnd,
    nextRunAt: f.nextRunAt ? new Date(f.nextRunAt).toISOString() : null,
    lastRunAt: f.lastRunAt ? new Date(f.lastRunAt).toISOString() : null,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

function computeNextRun(cron: string | null | undefined, timezone: string | null | undefined, from = new Date()) {
  if (!cron) return null;
  try {
    return nextCronDate(cron, timezone || 'Europe/Lisbon', from);
  } catch {
    return null;
  }
}

export function listFlows() {
  const latestByFlow = new Map<string, {
    id: string;
    status: string;
    startedAt: Date | string;
    finishedAt: Date | string | null;
    dryRun: boolean;
  }>();
  for (const run of runsRepo.list()) {
    if (latestByFlow.has(run.flowId)) continue;
    latestByFlow.set(run.flowId, {
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? null,
      dryRun: Boolean(run.dryRun),
    });
  }

  return flowsRepo.list().map((f) => {
    const base = serializeFlow(f)!;
    return {
      ...base,
      lastRun: latestByFlow.get(f.id) ?? null,
      nextRun: f.scheduleEnabled && f.nextRunAt
        ? {
          at: new Date(f.nextRunAt).toISOString(),
          policyId: null,
          policyName: null,
        }
        : null,
    };
  });
}

export function getFlow(id: string) {
  const f = flowsRepo.findById(id);
  if (!f) throw new AppError(404, 'not found', 'not_found');
  return serializeFlow(f);
}

type FlowInput = {
  name?: string;
  description?: string | null;
  graph?: unknown;
  scheduleEnabled?: boolean;
  cron?: string | null;
  timezone?: string | null;
  blackoutStart?: string | null;
  blackoutEnd?: string | null;
};

function scheduleFields(input: FlowInput, existing?: ReturnType<typeof flowsRepo.findById>) {
  const scheduleEnabled = input.scheduleEnabled != null
    ? Boolean(input.scheduleEnabled)
    : Boolean(existing?.scheduleEnabled);
  const cron = input.cron !== undefined ? input.cron : (existing?.cron ?? null);
  const timezone = input.timezone !== undefined
    ? input.timezone
    : (existing?.timezone || 'Europe/Lisbon');
  const blackoutStart = input.blackoutStart !== undefined
    ? input.blackoutStart
    : (existing?.blackoutStart ?? null);
  const blackoutEnd = input.blackoutEnd !== undefined
    ? input.blackoutEnd
    : (existing?.blackoutEnd ?? null);

  let nextRunAt = existing?.nextRunAt ?? null;
  if (input.scheduleEnabled != null || input.cron !== undefined || input.timezone !== undefined) {
    nextRunAt = scheduleEnabled && cron
      ? computeNextRun(cron, timezone)
      : null;
  }

  return {
    scheduleEnabled,
    cron,
    timezone,
    blackoutStart,
    blackoutEnd,
    nextRunAt,
  };
}

export async function createFlow(input: FlowInput, actor: string) {
  const id = uuid();
  const now = new Date();
  const graph = migrateFlowGraph(input.graph || { nodes: [], edges: [] });
  const schedule = scheduleFields(input);
  flowsRepo.insert({
    id,
    name: String(input.name || 'Untitled'),
    description: input.description ?? null,
    graphJson: JSON.stringify(graph),
    ...schedule,
    createdAt: now,
    updatedAt: now,
  });
  await audit({ actor, action: 'flow.created', entity: 'flow', entityId: id });
  return { id };
}

export async function updateFlow(id: string, input: FlowInput, actor: string) {
  const existing = flowsRepo.findById(id);
  if (!existing) throw new AppError(404, 'not found', 'not_found');
  const graph = input.graph
    ? migrateFlowGraph(input.graph)
    : migrateFlowGraph(JSON.parse(existing.graphJson));
  const schedule = scheduleFields(input, existing);
  flowsRepo.update(id, {
    name: input.name != null ? String(input.name) : existing.name,
    description: input.description !== undefined ? input.description : existing.description,
    graphJson: JSON.stringify(graph),
    ...schedule,
    updatedAt: new Date(),
  });
  await audit({ actor, action: 'flow.updated', entity: 'flow', entityId: id });
}

export function exportFlow(id: string) {
  const f = flowsRepo.findById(id);
  if (!f) throw new AppError(404, 'not found', 'not_found');
  return {
    version: 2,
    name: f.name,
    description: f.description,
    graph: migrateFlowGraph(JSON.parse(f.graphJson)),
    scheduleEnabled: Boolean(f.scheduleEnabled),
    cron: f.cron,
    timezone: f.timezone,
    blackoutStart: f.blackoutStart,
    blackoutEnd: f.blackoutEnd,
  };
}

export async function importFlow(input: FlowInput, actor: string) {
  return createFlow(input, actor).then(async (r) => {
    await audit({ actor, action: 'flow.imported', entity: 'flow', entityId: r.id });
    return r;
  });
}

export async function duplicateFlow(id: string, actor: string) {
  const existing = flowsRepo.findById(id);
  if (!existing) throw new AppError(404, 'not found', 'not_found');
  const newId = uuid();
  const now = new Date();
  const graph = migrateFlowGraph(JSON.parse(existing.graphJson));
  const schedule = scheduleFields({
    scheduleEnabled: existing.scheduleEnabled,
    cron: existing.cron,
    timezone: existing.timezone,
    blackoutStart: existing.blackoutStart,
    blackoutEnd: existing.blackoutEnd,
  });
  flowsRepo.insert({
    id: newId,
    name: `${existing.name} (copy)`,
    description: existing.description,
    graphJson: JSON.stringify(graph),
    ...schedule,
    createdAt: now,
    updatedAt: now,
  });
  await audit({ actor, action: 'flow.duplicated', entity: 'flow', entityId: newId, payload: { sourceId: id } });
  return {
    id: newId,
    name: `${existing.name} (copy)`,
    description: existing.description,
    updatedAt: now.toISOString(),
    graph,
  };
}

export async function deleteFlow(id: string, actor: string) {
  const existing = flowsRepo.findById(id);
  if (!existing) throw new AppError(404, 'not found', 'not_found');
  flowsRepo.delete(id);
  await audit({ actor, action: 'flow.deleted', entity: 'flow', entityId: id });
}

export async function runFlow(
  flowId: string,
  input: { context?: Record<string, unknown>; dryRun?: boolean },
  actor: string,
) {
  try {
    const runId = await startFlowRun({
      flowId,
      triggerSource: 'manual',
      context: input.context || {},
      dryRun: Boolean(input.dryRun),
      actor,
    });
    return { runId };
  } catch (err) {
    logger.warn('flow run rejected', { flowId, err: err instanceof Error ? err.message : String(err) });
    throw new AppError(409, 'could not start flow run', 'run_conflict');
  }
}
