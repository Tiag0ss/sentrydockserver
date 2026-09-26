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

type UpdateTarget = {
  id: string;
  agentId: string;
  containerName: string;
  /** Docker Compose project label from the running container (if any). */
  composeProject?: string | null;
  /** Matched SentryDock compose project id (when managed here). */
  composeProjectId?: string | null;
};

type FlowNodeOut = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
};

type FlowEdgeOut = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
};

/**
 * check → approval → split
 *   each container: own lane pull → (compose_up | recreate) → healthy → join
 * → notify
 */
function buildContainerUpdateGraph(opts: {
  imageId: string;
  imageLabel: string;
  targets: UpdateTarget[];
}) {
  const ts = Date.now().toString(36);
  const checkId = `n-${ts}-check`;
  const approvalId = `n-${ts}-appr`;
  const splitId = `n-${ts}-split`;
  const joinId = `n-${ts}-join`;
  const notifyOkId = `n-${ts}-ok`;
  const notifyNoId = `n-${ts}-nou`;
  const notifyErrId = `n-${ts}-err`;

  const laneGapY = 160;
  const baseY = 40;

  const nodes: FlowNodeOut[] = [
    {
      id: checkId,
      type: 'check_image_update',
      position: { x: 40, y: baseY + Math.max(0, (opts.targets.length - 1) * laneGapY) / 2 },
      data: {
        label: 'Check update',
        nodeType: 'check_image_update',
        retries: 1,
        imageId: opts.imageId,
        targets: opts.targets.map((t) => ({
          id: t.id,
          agentId: t.agentId,
          containerName: t.containerName,
        })),
        advancePinOnSuccess: false,
      },
    },
    {
      id: approvalId,
      type: 'wait_approval',
      position: { x: 280, y: baseY + Math.max(0, (opts.targets.length - 1) * laneGapY) / 2 },
      data: {
        label: 'Wait approval',
        nodeType: 'wait_approval',
        retries: 0,
        templateKey: 'awaiting_approval',
      },
    },
    {
      id: splitId,
      type: 'split',
      position: { x: 520, y: baseY + Math.max(0, (opts.targets.length - 1) * laneGapY) / 2 },
      data: {
        label: 'Split',
        nodeType: 'split',
        retries: 0,
        targetsSource: 'context',
        branches: opts.targets.map((t) => ({
          id: t.id,
          label: t.containerName,
          agentId: t.agentId,
          containerName: t.containerName,
        })),
      },
    },
    {
      id: joinId,
      type: 'join',
      position: { x: 1480, y: baseY + Math.max(0, (opts.targets.length - 1) * laneGapY) / 2 },
      data: {
        label: 'Join',
        nodeType: 'join',
        retries: 0,
        mode: 'wait_all',
      },
    },
    {
      id: notifyOkId,
      type: 'notify',
      position: { x: 1720, y: baseY + Math.max(0, (opts.targets.length - 1) * laneGapY) / 2 },
      data: {
        label: 'Notify',
        nodeType: 'notify',
        retries: 0,
        templateKey: 'update_success',
        level: 'info',
      },
    },
    {
      id: notifyNoId,
      type: 'notify',
      position: { x: 280, y: baseY + Math.max(opts.targets.length, 1) * laneGapY + 40 },
      data: {
        label: 'No update',
        nodeType: 'notify',
        retries: 0,
        message: `${opts.imageLabel}: no updates ({{image}}).`,
        level: 'info',
      },
    },
    {
      id: notifyErrId,
      type: 'notify',
      position: { x: 280, y: baseY + Math.max(opts.targets.length, 1) * laneGapY + 180 },
      data: {
        label: 'Error',
        nodeType: 'notify',
        retries: 0,
        templateKey: 'execution_failed',
        level: 'error',
      },
    },
  ];

  const edges: FlowEdgeOut[] = [
    { id: `e-${ts}-upd`, source: checkId, target: approvalId, sourceHandle: 'update' },
    { id: `e-${ts}-nou`, source: checkId, target: notifyNoId, sourceHandle: 'no_update' },
    { id: `e-${ts}-err`, source: checkId, target: notifyErrId, sourceHandle: 'error' },
    { id: `e-${ts}-appr`, source: approvalId, target: splitId, sourceHandle: 'out' },
    { id: `e-${ts}-join`, source: joinId, target: notifyOkId, sourceHandle: 'out' },
  ];

  if (!opts.targets.length) {
    // Empty template lane so the editor still has a path to wire
    const pullId = `n-${ts}-l0-pull`;
    const recId = `n-${ts}-l0-apply`;
    const hltId = `n-${ts}-l0-hlt`;
    nodes.push(
      {
        id: pullId,
        type: 'pull_image',
        position: { x: 760, y: baseY },
        data: { label: 'Pull', nodeType: 'pull_image', retries: 1, imageId: opts.imageId },
      },
      {
        id: recId,
        type: 'recreate_container',
        position: { x: 1000, y: baseY },
        data: { label: 'Recreate', nodeType: 'recreate_container', retries: 1, imageId: opts.imageId },
      },
      {
        id: hltId,
        type: 'wait_healthy',
        position: { x: 1240, y: baseY },
        data: {
          label: 'Wait healthy',
          nodeType: 'wait_healthy',
          retries: 0,
          timeoutMs: 120_000,
          probeType: 'docker',
        },
      },
    );
    edges.push(
      { id: `e-${ts}-spl`, source: splitId, target: pullId, sourceHandle: 'out' },
      { id: `e-${ts}-pull`, source: pullId, target: recId, sourceHandle: 'out' },
      { id: `e-${ts}-rec`, source: recId, target: hltId, sourceHandle: 'out' },
      { id: `e-${ts}-hlt`, source: hltId, target: joinId, sourceHandle: 'out' },
    );
    return { nodes, edges };
  }

  opts.targets.forEach((t, i) => {
    const y = baseY + i * laneGapY;
    // Lane index keeps node ids unique (agent UUID + container name truncates and collides).
    const pullId = `n-${ts}-l${i}-pull`;
    const applyId = `n-${ts}-l${i}-apply`;
    const hltId = `n-${ts}-l${i}-hlt`;
    const useCompose = Boolean(t.composeProjectId);

    nodes.push({
      id: pullId,
      type: 'pull_image',
      position: { x: 760, y },
      data: {
        label: `Pull · ${t.containerName}`,
        nodeType: 'pull_image',
        retries: 1,
        imageId: opts.imageId,
        agentId: t.agentId,
        containerName: t.containerName,
      },
    });

    if (useCompose) {
      nodes.push({
        id: applyId,
        type: 'compose_up',
        position: { x: 1000, y },
        data: {
          label: `Compose · ${t.composeProject || t.containerName}`,
          nodeType: 'compose_up',
          retries: 1,
          composeProjectId: t.composeProjectId,
          agentId: t.agentId,
          containerName: t.containerName,
        },
      });
    } else {
      nodes.push({
        id: applyId,
        type: 'recreate_container',
        position: { x: 1000, y },
        data: {
          label: `Recreate · ${t.containerName}`,
          nodeType: 'recreate_container',
          retries: 1,
          imageId: opts.imageId,
          agentId: t.agentId,
          containerName: t.containerName,
        },
      });
    }

    nodes.push({
      id: hltId,
      type: 'wait_healthy',
      position: { x: 1240, y },
      data: {
        label: `Healthy · ${t.containerName}`,
        nodeType: 'wait_healthy',
        retries: 0,
        timeoutMs: 120_000,
        probeType: 'docker',
        agentId: t.agentId,
        containerName: t.containerName,
      },
    });

    edges.push(
      { id: `e-${ts}-l${i}-spl`, source: splitId, target: pullId, sourceHandle: t.id },
      { id: `e-${ts}-l${i}-pull`, source: pullId, target: applyId, sourceHandle: 'out' },
      { id: `e-${ts}-l${i}-apply`, source: applyId, target: hltId, sourceHandle: 'out' },
      { id: `e-${ts}-l${i}-hlt`, source: hltId, target: joinId, sourceHandle: 'out' },
    );
  });

  return { nodes, edges };
}

/**
 * Discover running containers that use a catalog image across online agents,
 * then create an update flow with one split lane per container
 * (compose_up when the container belongs to a SentryDock Compose project, else recreate).
 */
export async function createUpdateFlowFromImage(
  imageId: string,
  actor: string,
  selected?: Array<{ agentId: string; containerName: string }>,
) {
  const { listRunningContainersForImage } = await import('./imagesService');
  const { imagesRepo } = await import('../repositories/imagesRepo');
  const { composeProjectsRepo } = await import('../repositories/composeRepo');

  const row = imagesRepo.findById(imageId) || imagesRepo.findByKey(imageId);
  if (!row) throw new AppError(404, 'image not found', 'not_found');

  const composeByName = new Map(
    composeProjectsRepo.list().map((p) => [p.name.toLowerCase(), p]),
  );

  const running = await listRunningContainersForImage(row.id);
  const discovered = new Map<string, UpdateTarget>();
  for (const ag of running.agents) {
    if (!ag.online) continue;
    for (const c of ag.containers) {
      const id = `${ag.agentId}:${c.name}`;
      const composeName = c.composeProject ? String(c.composeProject).trim() : '';
      const matched = composeName
        ? composeByName.get(composeName.toLowerCase())
        : undefined;
      discovered.set(id, {
        id,
        agentId: ag.agentId,
        containerName: c.name,
        composeProject: composeName || null,
        composeProjectId: matched?.id || null,
      });
    }
  }

  let targets: UpdateTarget[];
  if (selected != null) {
    if (!selected.length) {
      throw new AppError(400, 'select at least one container', 'no_targets');
    }
    targets = [];
    const missing: string[] = [];
    for (const s of selected) {
      const id = `${s.agentId}:${s.containerName}`;
      const hit = discovered.get(id);
      if (!hit) {
        missing.push(id);
        continue;
      }
      targets.push(hit);
    }
    if (missing.length) {
      throw new AppError(
        400,
        `Unknown or offline containers: ${missing.join(', ')}`,
        'invalid_targets',
      );
    }
  } else {
    targets = [...discovered.values()];
  }

  const agentIds = new Set(targets.map((t) => t.agentId));
  const warnings: string[] = [];
  if (!targets.length) {
    warnings.push(
      'No matching containers on online agents — pick targets in the check node after opening the editor.',
    );
  }
  for (const t of targets) {
    if (t.composeProject && !t.composeProjectId) {
      warnings.push(
        `Container «${t.containerName}» reports Compose project «${t.composeProject}» but it is not in SentryDock — using Recreate.`,
      );
    }
  }

  const imageLabel = `${row.key} (${row.repository})`;
  const graph = buildContainerUpdateGraph({
    imageId: row.id,
    imageLabel,
    targets,
  });

  const composeCount = targets.filter((t) => t.composeProjectId).length;
  const recreateCount = targets.length - composeCount;
  const name = `Update · ${row.name || row.key}`;
  const description = [
    `Generated from catalog image ${imageLabel}.`,
    `Agents: ${agentIds.size}. Containers: ${targets.length}`
      + (targets.length ? ` (compose ${composeCount}, recreate ${recreateCount})` : '')
      + '.',
  ].join(' ');

  const created = await createFlow({
    name,
    description,
    graph,
    scheduleEnabled: false,
  }, actor);

  await audit({
    actor,
    action: 'flow.created_from_image',
    entity: 'flow',
    entityId: created.id,
    payload: {
      imageId: row.id,
      imageKey: row.key,
      targets: targets.length,
      agents: agentIds.size,
      composeCount,
      recreateCount,
    },
  });

  return {
    flowId: created.id,
    name,
    imageId: row.id,
    imageKey: row.key,
    targetsCount: targets.length,
    agentCount: agentIds.size,
    composeCount,
    recreateCount,
    warnings,
  };
}

