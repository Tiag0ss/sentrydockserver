import { v4 as uuid } from 'uuid';
import { agentsRepo } from '../repositories/agentsRepo';
import { composeProjectsRepo, composeStatesRepo } from '../repositories/composeRepo';
import { agentGateway } from './agentGateway';
import { audit } from './audit';
import { getAgentEnvMap } from './agentsService';
import { getGlobalComposeEnv } from './secretsService';
import { resolveSdImageEnvForYaml, scanSdImageKeys } from './imagesService';
import { hashComposeDesired, hashYamlOnly } from './imageTarget';
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
        },
        600_000,
      ) as { services?: unknown[] };

      upsertState(id, agentId, {
        desiredHash,
        appliedHash: desiredHash,
        status: 'synced',
        lastDeployedAt: new Date(),
        lastCheckedAt: new Date(),
        lastError: null,
        servicesJson: JSON.stringify(res.services || []),
      });
      results.push({ agentId, agentName, status: 'synced' });
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

export async function checkComposeProject(id: string, agentIds?: string[]) {
  const project = composeProjectsRepo.findById(id);
  if (!project) throw new AppError(404, 'compose project not found', 'not_found');

  const targets = agentIds?.length
    ? agentIds
    : composeStatesRepo.listByProject(id).map((s) => s.agentId);

  const results: Array<{ agentId: string; status: string; error?: string }> = [];

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
      ) as { exists?: boolean; services?: unknown[]; error?: string };

      const existing = composeStatesRepo.find(id, agentId);
      let status = 'absent';
      if (!res.exists) status = 'absent';
      else if (existing?.appliedHash && existing.appliedHash === desiredHash) status = 'synced';
      else if (existing?.appliedHash) status = 'drift';
      else status = 'drift';

      upsertState(id, agentId, {
        desiredHash,
        status,
        lastCheckedAt: new Date(),
        lastError: res.error || null,
        servicesJson: JSON.stringify(res.services || []),
      });
      results.push({ agentId, status });
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
