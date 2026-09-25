import { v4 as uuid } from 'uuid';
import { flowsRepo } from '../repositories/flowsRepo';
import { runsRepo, policiesRepo } from '../repositories/domainRepo';
import { audit } from './audit';
import { startFlowRun } from './flowEngine';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

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

  const nextByFlow = new Map<string, { at: Date; policyId: string; policyName: string }>();
  for (const policy of policiesRepo.listEnabled()) {
    if (!policy.nextRunAt) continue;
    const prev = nextByFlow.get(policy.flowId);
    const at = policy.nextRunAt instanceof Date ? policy.nextRunAt : new Date(policy.nextRunAt);
    if (!prev || at.getTime() < prev.at.getTime()) {
      nextByFlow.set(policy.flowId, {
        at,
        policyId: policy.id,
        policyName: policy.name || '',
      });
    }
  }

  return flowsRepo.list().map((f) => {
    const next = nextByFlow.get(f.id);
    return {
      ...f,
      graph: JSON.parse(f.graphJson),
      lastRun: latestByFlow.get(f.id) ?? null,
      nextRun: next
        ? { at: next.at.toISOString(), policyId: next.policyId, policyName: next.policyName || null }
        : null,
    };
  });
}

export async function createFlow(
  input: { name?: string; description?: string | null; graph?: unknown },
  actor: string,
) {
  const id = uuid();
  const now = new Date();
  flowsRepo.insert({
    id,
    name: String(input.name || 'Untitled'),
    description: input.description ?? null,
    graphJson: JSON.stringify(input.graph || { nodes: [], edges: [] }),
    createdAt: now,
    updatedAt: now,
  });
  await audit({ actor, action: 'flow.created', entity: 'flow', entityId: id });
  return { id };
}

export async function updateFlow(
  id: string,
  input: { name?: string; description?: string | null; graph?: unknown },
  actor: string,
) {
  const existing = flowsRepo.findById(id);
  if (!existing) throw new AppError(404, 'not found', 'not_found');
  flowsRepo.update(id, {
    name: input.name != null ? String(input.name) : existing.name,
    description: input.description !== undefined ? input.description : existing.description,
    graphJson: input.graph ? JSON.stringify(input.graph) : existing.graphJson,
    updatedAt: new Date(),
  });
  await audit({ actor, action: 'flow.updated', entity: 'flow', entityId: id });
}

export function exportFlow(id: string) {
  const f = flowsRepo.findById(id);
  if (!f) throw new AppError(404, 'not found', 'not_found');
  return {
    version: 1,
    name: f.name,
    description: f.description,
    graph: JSON.parse(f.graphJson),
  };
}

export async function importFlow(
  input: { name?: string; description?: string | null; graph?: unknown },
  actor: string,
) {
  const id = uuid();
  const now = new Date();
  flowsRepo.insert({
    id,
    name: String(input.name || 'Imported'),
    description: input.description ?? null,
    graphJson: JSON.stringify(input.graph || { nodes: [], edges: [] }),
    createdAt: now,
    updatedAt: now,
  });
  await audit({ actor, action: 'flow.imported', entity: 'flow', entityId: id });
  return { id };
}

export async function duplicateFlow(id: string, actor: string) {
  const existing = flowsRepo.findById(id);
  if (!existing) throw new AppError(404, 'not found', 'not_found');
  const newId = uuid();
  const now = new Date();
  flowsRepo.insert({
    id: newId,
    name: `${existing.name} (copy)`,
    description: existing.description,
    graphJson: existing.graphJson,
    createdAt: now,
    updatedAt: now,
  });
  await audit({ actor, action: 'flow.duplicated', entity: 'flow', entityId: newId, payload: { sourceId: id } });
  return {
    id: newId,
    name: `${existing.name} (copy)`,
    description: existing.description,
    updatedAt: now.toISOString(),
    graph: JSON.parse(existing.graphJson),
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
