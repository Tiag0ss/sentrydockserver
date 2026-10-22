import { v4 as uuid } from 'uuid';
import { agentsRepo } from '../repositories/agentsRepo';
import { composeProjectsRepo, composeStatesRepo } from '../repositories/composeRepo';
import { agentGateway } from './agentGateway';
import { audit } from './audit';
import { getAgentEnvMap } from './agentsService';
import { getGlobalComposeEnv } from './secretsService';
import { resolveSdImageEnvForYaml, scanSdImageKeys, listRunningContainersForImage } from './imagesService';
import { imagesRepo } from '../repositories/imagesRepo';
import { hashComposeDesired, hashYamlOnly } from './imageTarget';
import { expectedComposeDeployPath } from '../../lib/composePath';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

/** Agent env wins over global string secrets; SD_IMAGE_* from catalog win over both. */
async function resolveDeployEnv(agentId: string, yamlText: string) {
  const base = {
    ...getGlobalComposeEnv(),
    ...getAgentEnvMap(agentId),
  };
  const { env: sdEnv, registryAuths, missingKeys } = await resolveSdImageEnvForYaml(yamlText, agentId);
  if (missingKeys.length) {
    throw new AppError(
      400,
      `Compose references missing catalog images: ${missingKeys.map((k) => `SD_IMAGE_${k}`).join(', ')}`,
      'missing_sd_image',
    );
  }
  return {
    env: { ...base, ...sdEnv },
    registryAuths,
    referencedKeys: scanSdImageKeys(yamlText),
  };
}

function upsertState(
  composeProjectId: string,
  agentId: string,
  patch: Partial<{
    desiredHash: string | null;
    appliedHash: string | null;
    status: string;
    lastDeployedAt: Date | null;
    lastCheckedAt: Date | null;
    lastError: string | null;
    servicesJson: string | null;
  }>,
) {
  const existing = composeStatesRepo.find(composeProjectId, agentId);
  if (existing) {
    composeStatesRepo.update(existing.id, patch);
    return existing.id;
  }
  const id = uuid();
  composeStatesRepo.insert({
    id,
    composeProjectId,
    agentId,
    desiredHash: patch.desiredHash ?? null,
    appliedHash: patch.appliedHash ?? null,
    status: patch.status || 'absent',
    lastDeployedAt: patch.lastDeployedAt ?? null,
    lastCheckedAt: patch.lastCheckedAt ?? null,
    lastError: patch.lastError ?? null,
    servicesJson: patch.servicesJson ?? null,
  });
  return id;
}

export function listComposeProjects() {
  return composeProjectsRepo.list().map((p) => ({
    ...p,
    states: composeStatesRepo.listByProject(p.id).map((s) => ({
      ...s,
      agentName: agentsRepo.findById(s.agentId)?.name || s.agentId,
      online: agentGateway.isOnline(s.agentId),
    })),
  }));
}

export function getComposeProject(id: string) {
  const p = composeProjectsRepo.findById(id);
  if (!p) throw new AppError(404, 'compose project not found', 'not_found');
  return {
    ...p,
    states: composeStatesRepo.listByProject(p.id).map((s) => ({
      ...s,
      agentName: agentsRepo.findById(s.agentId)?.name || s.agentId,
      online: agentGateway.isOnline(s.agentId),
    })),
  };
}

export async function createComposeProject(input: { name: string; yamlText: string }, actor: string) {
  const name = String(input.name || '').trim();
  if (!name) throw new AppError(400, 'name required', 'validation');
  if (composeProjectsRepo.findByName(name)) {
    throw new AppError(409, 'name already exists', 'conflict');
  }
  const yamlText = String(input.yamlText || '');
  const id = uuid();
  const now = new Date();
  composeProjectsRepo.insert({
    id,
    name,
    yamlText,
    contentHash: hashYamlOnly(yamlText),
    createdAt: now,
    updatedAt: now,
  });
  await audit({ actor, action: 'compose.created', entity: 'compose_project', entityId: id });
  return getComposeProject(id);
}

export type DiscoveredComposeProject = {
  projectName: string;
  services: string[];
  configFiles: string[];
  workingDir: string | null;
  yamlText: string | null;
  yamlSource: 'file' | 'compose_config' | null;
  error?: string;
  alreadyImported: boolean;
};

/** Ask an online agent for Compose projects visible on its Docker host. */
export async function discoverComposeFromAgent(agentId: string): Promise<{
  agentId: string;
  agentName: string;
  projects: DiscoveredComposeProject[];
}> {
  const agent = agentsRepo.findById(agentId);
  if (!agent) throw new AppError(404, 'agent not found', 'not_found');
  if (!agentGateway.isOnline(agentId)) {
    throw new AppError(409, 'agent offline', 'agent_offline');
  }
  const res = await agentGateway.sendCommand(
    agentId,
    'docker.compose.discover',
    {},
    90_000,
  ) as { projects?: DiscoveredComposeProject[] };

  const existing = new Set(
    composeProjectsRepo.list().map((p) => p.name.toLowerCase()),
  );
  const projects = (Array.isArray(res.projects) ? res.projects : []).map((p) => ({
    ...p,
    alreadyImported: existing.has(String(p.projectName || '').toLowerCase()),
  }));

  return { agentId, agentName: agent.name, projects };
}

/** Import a discovered Compose YAML into the catalog (optionally rename on conflict). */
export async function importDiscoveredCompose(
  input: { name?: string; yamlText: string; sourceProjectName?: string; agentId?: string },
  actor: string,
) {
  const yamlText = String(input.yamlText || '').trim();
  if (!yamlText) throw new AppError(400, 'yamlText required', 'validation');
  let name = String(input.name || input.sourceProjectName || '').trim();
  if (!name) throw new AppError(400, 'name required', 'validation');
  if (composeProjectsRepo.findByName(name)) {
    name = uniqueComposeCopyName(name);
  }
  const created = await createComposeProject({ name, yamlText }, actor);
  await audit({
    actor,
    action: 'compose.imported_from_agent',
    entity: 'compose_project',
    entityId: created.id,
    payload: {
      sourceProjectName: input.sourceProjectName || null,
      agentId: input.agentId || null,
      finalName: name,
    },
  });
  return created;
}

export async function updateComposeProject(
  id: string,
  input: { name?: string; yamlText?: string },
  actor: string,
) {
  const existing = composeProjectsRepo.findById(id);
  if (!existing) throw new AppError(404, 'compose project not found', 'not_found');
  const name = input.name != null ? String(input.name).trim() : existing.name;
  if (!name) throw new AppError(400, 'name required', 'validation');
  const other = composeProjectsRepo.findByName(name);
  if (other && other.id !== id) throw new AppError(409, 'name already exists', 'conflict');
  const yamlText = input.yamlText != null ? String(input.yamlText) : existing.yamlText;
  composeProjectsRepo.update(id, {
    name,
    yamlText,
    contentHash: hashYamlOnly(yamlText),
    updatedAt: new Date(),
  });
  // Mark known agents as drift when yaml changes
  if (yamlText !== existing.yamlText) {
    for (const s of composeStatesRepo.listByProject(id)) {
      try {
        const { env } = await resolveDeployEnv(s.agentId, yamlText);
        const desired = hashComposeDesired(yamlText, env);
        if (s.appliedHash && s.appliedHash !== desired) {
          composeStatesRepo.update(s.id, { status: 'drift', desiredHash: desired });
        } else {
          composeStatesRepo.update(s.id, { desiredHash: desired });
        }
      } catch (err) {
        logger.warn('compose drift hash failed', {
          agentId: s.agentId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  await audit({ actor, action: 'compose.updated', entity: 'compose_project', entityId: id });
  return getComposeProject(id);
}

export async function deleteComposeProject(id: string, actor: string) {
  const existing = composeProjectsRepo.findById(id);
  if (!existing) throw new AppError(404, 'compose project not found', 'not_found');
  composeStatesRepo.deleteByProject(id);
  composeProjectsRepo.delete(id);
  await audit({ actor, action: 'compose.deleted', entity: 'compose_project', entityId: id });
  return { ok: true };
}

function uniqueComposeCopyName(base: string): string {
  const root = base.replace(/\s*\(copy(?:\s+\d+)?\)\s*$/i, '').trim() || base;
  let candidate = `${root} (copy)`;
  if (!composeProjectsRepo.findByName(candidate)) return candidate;
  for (let i = 2; i < 1000; i += 1) {
    candidate = `${root} (copy ${i})`;
    if (!composeProjectsRepo.findByName(candidate)) return candidate;
  }
  return `${root} (copy ${Date.now()})`;
}

/** Duplica o YAML/nome; estados de agentes não são copiados. */
export async function duplicateComposeProject(id: string, actor: string) {
  const existing = composeProjectsRepo.findById(id);
  if (!existing) throw new AppError(404, 'compose project not found', 'not_found');
  const name = uniqueComposeCopyName(existing.name);
  const newId = uuid();
  const now = new Date();
  composeProjectsRepo.insert({
    id: newId,
    name,
    yamlText: existing.yamlText,
    contentHash: hashYamlOnly(existing.yamlText),
    createdAt: now,
    updatedAt: now,
  });
  await audit({
    actor,
    action: 'compose.duplicated',
    entity: 'compose_project',
    entityId: newId,
    payload: { sourceId: id },
  });
  return getComposeProject(newId);
}

export async function deployComposeProject(
  id: string,
  input: { agentIds: string[]; force?: boolean },
  actor: string,
) {
  const project = composeProjectsRepo.findById(id);
  if (!project) throw new AppError(404, 'compose project not found', 'not_found');
  const agentIds = (input.agentIds || []).map(String).filter(Boolean);
  if (!agentIds.length) throw new AppError(400, 'agentIds required', 'validation');

  const results: Array<{
    agentId: string;
    agentName: string;
    status: string;
    skipped?: boolean;
    error?: string;
    projectPath?: string;
  }> = [];

  for (const agentId of agentIds) {
    const agent = agentsRepo.findById(agentId);
    const agentName = agent?.name || agentId;
    if (!agentGateway.isOnline(agentId)) {
      upsertState(id, agentId, {
        status: 'error',
        lastError: 'agent offline',
        lastCheckedAt: new Date(),
      });
      results.push({ agentId, agentName, status: 'error', error: 'agent offline' });
      continue;
    }

    try {
      const { env, registryAuths } = await resolveDeployEnv(agentId, project.yamlText);
      const desiredHash = hashComposeDesired(project.yamlText, env);
      const existing = composeStatesRepo.find(id, agentId);

      if (!input.force && existing?.appliedHash === desiredHash && existing.status === 'synced') {
        results.push({ agentId, agentName, status: 'synced', skipped: true });
        continue;
      }

      upsertState(id, agentId, {
        desiredHash,
        status: 'pending',
        lastError: null,
        lastCheckedAt: new Date(),
      });

      const res = await agentGateway.sendCommand(
        agentId,
        'docker.compose.apply',
        {
          projectName: project.name,
          yaml: project.yamlText,
          env,
          registryAuths,
          action: 'up',
          // Flow updates and manual "force" deploys must recreate even when the
          // compose file hash is unchanged (:latest digest moved / digest-pin rollback).
          forceRecreate: Boolean(input.force),
        },
        600_000,
      ) as { services?: unknown[]; projectPath?: string };

      upsertState(id, agentId, {
        desiredHash,
        appliedHash: desiredHash,
        status: 'synced',
        lastDeployedAt: new Date(),
        lastCheckedAt: new Date(),
        lastError: null,
        servicesJson: JSON.stringify(res.services || []),
      });
      results.push({
        agentId,
        agentName,
        status: 'synced',
        ...(res.projectPath ? { projectPath: res.projectPath } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('compose deploy failed', { agentId, projectId: id, err: msg });
      upsertState(id, agentId, {
        status: 'error',
        lastError: msg,
        lastCheckedAt: new Date(),
      });
      results.push({ agentId, agentName, status: 'error', error: msg });
    }
  }

  await audit({
    actor,
    action: 'compose.deployed',
    entity: 'compose_project',
    entityId: id,
    payload: { agentIds, results },
  });

  return { projectId: id, results, project: getComposeProject(id) };
}

function composeServicesRunning(services: unknown[] | undefined): boolean {
  if (!Array.isArray(services) || services.length === 0) return false;
  return services.some((s) => {
    if (!s || typeof s !== 'object') return false;
    const row = s as Record<string, unknown>;
    const state = String(row.State || row.Status || '').toLowerCase();
    return state.includes('running') || /(^|\s)up(\s|$)/.test(state);
  });
}

export async function checkComposeProject(id: string, agentIds?: string[]) {
  const project = composeProjectsRepo.findById(id);
  if (!project) throw new AppError(404, 'compose project not found', 'not_found');

  const targets = agentIds?.length
    ? agentIds
    : composeStatesRepo.listByProject(id).map((s) => s.agentId);

  const results: Array<{
    agentId: string;
    status: string;
    error?: string;
    projectPath?: string;
    exists?: boolean;
  }> = [];

  for (const agentId of targets) {
    try {
      const { env } = await resolveDeployEnv(agentId, project.yamlText);
      const desiredHash = hashComposeDesired(project.yamlText, env);
      if (!agentGateway.isOnline(agentId)) {
        upsertState(id, agentId, {
          desiredHash,
          status: 'error',
          lastError: 'agent offline',
          lastCheckedAt: new Date(),
        });
        results.push({ agentId, status: 'error', error: 'agent offline' });
        continue;
      }
      const res = await agentGateway.sendCommand(
        agentId,
        'docker.compose.status',
        { projectName: project.name },
        60_000,
      ) as { exists?: boolean; services?: unknown[]; error?: string; projectPath?: string };

      const existing = composeStatesRepo.find(id, agentId);
      const services = Array.isArray(res.services) ? res.services : [];
      const running = composeServicesRunning(services);
      let status = 'absent';
      // Synced requires the YAML on disk, matching hash, AND a live stack.
      // File present after `compose down` / deleted containers must not stay "synced".
      if (!res.exists || !running) status = 'absent';
      else if (existing?.appliedHash && existing.appliedHash === desiredHash) status = 'synced';
      else if (existing?.appliedHash) status = 'drift';
      else status = 'drift';

      upsertState(id, agentId, {
        desiredHash,
        status,
        lastCheckedAt: new Date(),
        lastError: res.error || null,
        servicesJson: JSON.stringify(services),
      });
      results.push({
        agentId,
        status,
        exists: Boolean(res.exists),
        ...(res.projectPath ? { projectPath: res.projectPath } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      upsertState(id, agentId, {
        status: 'error',
        lastError: msg,
        lastCheckedAt: new Date(),
      });
      results.push({ agentId, status: 'error', error: msg });
    }
  }

  return { projectId: id, results, project: getComposeProject(id) };
}

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

function buildBasicComposeUpdateGraph(opts: {
  imageId: string;
  composeProjectId: string;
  targets: Array<{ id: string; agentId: string; containerName: string }>;
  projectName: string;
}): { nodes: FlowNodeOut[]; edges: FlowEdgeOut[] } {
  const ts = Date.now();
  const checkId = `check_image_update-${ts}`;
  const approvalId = `wait_approval-${ts}`;
  const splitId = `split-${ts}`;
  const joinId = `join-${ts}`;
  const notifyOkId = `notify-ok-${ts}`;
  const notifyFailId = `notify-fail-${ts}`;
  const notifyErrId = `notify-err-${ts}`;
  const ifAfterJoinId = `if-join-${ts}`;
  const laneGapY = 160;
  const baseY = 40;
  const midY = baseY + Math.max(0, (opts.targets.length - 1) * laneGapY) / 2;

  const nodes: FlowNodeOut[] = [
    {
      id: checkId,
      type: 'check_image_update',
      position: { x: 40, y: midY },
      data: {
        label: 'Check update',
        nodeType: 'check_image_update',
        retries: 0,
        imageId: opts.imageId,
        targets: opts.targets,
        advancePinOnSuccess: false,
      },
    },
    {
      id: approvalId,
      type: 'wait_approval',
      position: { x: 280, y: midY },
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
      position: { x: 520, y: midY },
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
      position: { x: 1480, y: midY },
      data: {
        label: 'Join',
        nodeType: 'join',
        retries: 0,
        mode: 'wait_all',
      },
    },
    {
      id: ifAfterJoinId,
      type: 'if',
      position: { x: 1720, y: midY },
      data: {
        label: 'OK after join?',
        nodeType: 'if',
        retries: 0,
        field: 'lastResult',
      },
    },
    {
      id: notifyOkId,
      type: 'notify',
      position: { x: 1960, y: midY - 70 },
      data: {
        label: 'Notify success',
        nodeType: 'notify',
        retries: 0,
        templateKey: 'update_success',
        level: 'info',
      },
    },
    {
      id: notifyFailId,
      type: 'notify',
      position: { x: 1960, y: midY + 70 },
      data: {
        label: 'Notify failed',
        nodeType: 'notify',
        retries: 0,
        templateKey: 'execution_failed',
        level: 'error',
      },
    },
    {
      id: notifyErrId,
      type: 'notify',
      position: { x: 280, y: baseY + Math.max(opts.targets.length, 1) * laneGapY + 40 },
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
    // no_update: no notify — silent end when nothing to update
    { id: `e-${ts}-err`, source: checkId, target: notifyErrId, sourceHandle: 'error' },
    { id: `e-${ts}-appr`, source: approvalId, target: splitId, sourceHandle: 'out' },
    { id: `e-${ts}-join`, source: joinId, target: ifAfterJoinId, sourceHandle: 'out' },
    { id: `e-${ts}-if-ok`, source: ifAfterJoinId, target: notifyOkId, sourceHandle: 'true' },
    { id: `e-${ts}-if-fail`, source: ifAfterJoinId, target: notifyFailId, sourceHandle: 'false' },
  ];

  const targets = opts.targets.length
    ? opts.targets
    : [{ id: 'out', agentId: '', containerName: '' }];

  targets.forEach((t, i) => {
    const y = baseY + i * laneGapY;
    const pullId = `pull_image-${ts}-l${i}`;
    const composeId = `compose_up-${ts}-l${i}`;
    const healthyId = `wait_healthy-${ts}-l${i}`;
    const label = t.containerName || opts.projectName;

    nodes.push(
      {
        id: pullId,
        type: 'pull_image',
        position: { x: 760, y },
        data: {
          label: t.containerName ? `Pull · ${label}` : 'Pull',
          nodeType: 'pull_image',
          retries: 1,
          imageId: opts.imageId,
          ...(t.agentId ? { agentId: t.agentId, containerName: t.containerName } : {}),
        },
      },
      {
        id: composeId,
        type: 'compose_up',
        position: { x: 1000, y },
        data: {
          label: t.containerName ? `Compose · ${label}` : 'Compose up',
          nodeType: 'compose_up',
          retries: 1,
          composeProjectId: opts.composeProjectId,
          projectPath: expectedComposeDeployPath(opts.projectName),
          ...(t.agentId ? { agentId: t.agentId, containerName: t.containerName } : {}),
        },
      },
      {
        id: healthyId,
        type: 'wait_healthy',
        position: { x: 1240, y },
        data: {
          label: t.containerName ? `Healthy · ${label}` : 'Wait healthy',
          nodeType: 'wait_healthy',
          retries: 0,
          timeoutMs: 120_000,
          probeType: 'docker',
          ...(t.agentId ? { agentId: t.agentId, containerName: t.containerName } : {}),
        },
      },
    );

    edges.push(
      {
        id: `e-${ts}-l${i}-spl`,
        source: splitId,
        target: pullId,
        sourceHandle: t.id || 'out',
      },
      { id: `e-${ts}-l${i}-pull`, source: pullId, target: composeId, sourceHandle: 'out' },
      { id: `e-${ts}-l${i}-cmp`, source: composeId, target: healthyId, sourceHandle: 'out' },
      { id: `e-${ts}-l${i}-hlt`, source: healthyId, target: joinId, sourceHandle: 'out' },
    );
  });

  return { nodes, edges };
}

/**
 * Cria um flow básico: check → aprovação → split → pull → compose_up → healthy → join → if → notify
 * para os agentes onde o projecto já foi instalado, usando a primeira imagem SD_IMAGE_* do YAML.
 */
export async function createUpdateFlowFromCompose(projectId: string, actor: string) {
  const project = composeProjectsRepo.findById(projectId);
  if (!project) throw new AppError(404, 'compose project not found', 'not_found');

  const keys = scanSdImageKeys(project.yamlText);
  if (!keys.length) {
    throw new AppError(
      400,
      'YAML has no ${SD_IMAGE_*} placeholders — add catalog images first',
      'no_sd_image',
    );
  }

  const missing: string[] = [];
  const catalogRows = keys.map((key) => {
    const row = imagesRepo.findByKey(key);
    if (!row) missing.push(key);
    return row;
  });
  if (missing.length) {
    throw new AppError(
      400,
      `Missing catalog images: ${missing.map((k) => `SD_IMAGE_${k}`).join(', ')}`,
      'missing_sd_image',
    );
  }

  const states = composeStatesRepo.listByProject(projectId);
  const agentIds = [...new Set(states.map((s) => s.agentId))];
  if (!agentIds.length) {
    throw new AppError(
      400,
      'No agents have this project yet — deploy to at least one agent first',
      'no_agents',
    );
  }

  const primary = catalogRows[0]!;
  const running = await listRunningContainersForImage(primary.id);
  const agentSet = new Set(agentIds);
  const targets: Array<{ id: string; agentId: string; containerName: string }> = [];
  for (const ag of running.agents) {
    if (!agentSet.has(ag.agentId)) continue;
    for (const c of ag.containers) {
      targets.push({
        id: `${ag.agentId}:${c.name}`,
        agentId: ag.agentId,
        containerName: c.name,
      });
    }
  }

  const extraKeys = keys.slice(1);
  const warnings: string[] = [];
  if (!targets.length) {
    warnings.push('No matching running containers found on installed agents — select targets in the check node.');
  }
  if (extraKeys.length) {
    warnings.push(
      `Check uses SD_IMAGE_${keys[0]}; other keys (${extraKeys.map((k) => `SD_IMAGE_${k}`).join(', ')}) are still applied on Compose deploy.`,
    );
  }

  const graph = buildBasicComposeUpdateGraph({
    imageId: primary.id,
    composeProjectId: projectId,
    targets,
    projectName: project.name,
  });

  const { createFlow } = await import('./flowsService');
  const name = `Update · ${project.name}`;
  const description = [
    `Gerado a partir do Compose «${project.name}».`,
    `Imagem: SD_IMAGE_${keys[0]} (${primary.repository}).`,
    `Agentes: ${agentIds.length}. Contentores no check: ${targets.length}.`,
  ].join(' ');

  const created = await createFlow({
    name,
    description,
    graph,
    scheduleEnabled: false,
  }, actor);

  await audit({
    actor,
    action: 'compose.update_flow_created',
    entity: 'compose_project',
    entityId: projectId,
    payload: {
      flowId: created.id,
      imageKey: keys[0],
      targets: targets.length,
      agents: agentIds.length,
    },
  });

  return {
    flowId: created.id,
    name,
    imageKey: keys[0],
    imageId: primary.id,
    targetsCount: targets.length,
    agentIds,
    warnings,
  };
}
