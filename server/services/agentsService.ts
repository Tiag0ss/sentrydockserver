import { v4 as uuid } from 'uuid';
import { agentsRepo } from '../repositories/agentsRepo';
import { hashToken, randomToken } from './crypto';
import { audit } from './audit';
import { agentGateway } from './agentGateway';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

export function listAgents() {
  return agentsRepo.list().map((r) => {
    let meta: Record<string, unknown> | null = null;
    try {
      meta = r.metaJson ? JSON.parse(r.metaJson) : null;
    } catch {
      meta = null;
    }
    const envObj = (meta?.env && typeof meta.env === 'object' && !Array.isArray(meta.env))
      ? (meta.env as Record<string, string>)
      : {};
    return {
      ...r,
      online: agentGateway.isOnline(r.id),
      meta: meta
        ? {
            containers: meta.containers,
            danglingImages: meta.danglingImages,
            diskUsedBytes: meta.diskUsedBytes,
            diskTotalBytes: meta.diskTotalBytes,
            // never expose env values or raw meta.env to the client
          }
        : null,
      labels: Array.isArray(meta?.labels) ? (meta!.labels as string[]) : [],
      envKeys: Object.keys(envObj).sort(),
    };
  });
}

export async function createAgent(input: { name: string; transport?: string }, actor: string) {
  const token = randomToken();
  const id = uuid();
  const transport = input.transport === 'grpc' ? 'grpc' : 'ws';
  agentsRepo.insert({
    id,
    name: input.name,
    tokenHash: hashToken(token),
    transport,
    status: 'offline',
    createdAt: new Date(),
  });
  await audit({ actor, action: 'agent.created', entity: 'agent', entityId: id });
  return { id, name: input.name, transport, token };
}

export async function deleteAgent(id: string, actor: string) {
  agentsRepo.delete(id);
  await audit({ actor, action: 'agent.deleted', entity: 'agent', entityId: id });
}

export async function listAgentContainers(agentId: string) {
  try {
    return await agentGateway.sendCommand(agentId, 'docker.list', { all: true });
  } catch (err) {
    logger.warn('agent containers failed', { agentId, err: err instanceof Error ? err.message : String(err) });
    throw new AppError(502, 'agent command failed', 'agent_unavailable');
  }
}

export async function listAgentImageTags(agentId: string, imageRepo: string, secretId?: string | null) {
  if (!imageRepo.trim()) throw new AppError(400, 'imageRepo required', 'validation');
  let auth: unknown;
  if (secretId) {
    try {
      const { getSecretPlain } = await import('./secretsService');
      const plain = getSecretPlain(secretId);
      if (plain) auth = JSON.parse(plain);
    } catch {
      auth = undefined;
    }
  }
  try {
    return await agentGateway.sendCommand(
      agentId,
      'image.listTags',
      { imageRepo, auth },
      120_000,
    );
  } catch (err) {
    logger.warn('agent listTags failed', { agentId, err: err instanceof Error ? err.message : String(err) });
    throw new AppError(502, 'agent command failed', 'agent_unavailable');
  }
}

export function updateAgentMeta(
  id: string,
  patch: {
    labels?: string[];
    env?: Record<string, string>;
    envUpsert?: Record<string, string>;
    envDelete?: string[];
  },
) {
  const row = agentsRepo.findById(id);
  if (!row) throw new AppError(404, 'agent not found', 'not_found');
  let meta: Record<string, unknown> = {};
  try {
    meta = row.metaJson ? JSON.parse(row.metaJson) : {};
  } catch {
    meta = {};
  }
  if (patch.labels !== undefined) {
    meta.labels = patch.labels.map((l) => String(l).trim()).filter(Boolean);
  }

  let env: Record<string, string> = {};
  if (meta.env && typeof meta.env === 'object' && !Array.isArray(meta.env)) {
    env = { ...(meta.env as Record<string, string>) };
  }

  if (patch.env !== undefined) {
    env = {};
    for (const [k, v] of Object.entries(patch.env)) {
      const key = String(k).trim();
      if (!key) continue;
      env[key] = String(v ?? '');
    }
  }
  if (patch.envDelete?.length) {
    for (const k of patch.envDelete) {
      delete env[String(k).trim()];
    }
  }
  if (patch.envUpsert) {
    for (const [k, v] of Object.entries(patch.envUpsert)) {
      const key = String(k).trim();
      if (!key) continue;
      const value = String(v ?? '');
      // Empty value on existing key = keep current (rotate only when provided)
      if (!value && key in env) continue;
      if (!value && !(key in env)) {
        throw new AppError(400, `env value required for ${key}`, 'validation');
      }
      env[key] = value;
    }
  }

  if (patch.env !== undefined || patch.envUpsert || patch.envDelete) {
    meta.env = env;
  }

  agentsRepo.update(id, { metaJson: JSON.stringify(meta) });
  return {
    id,
    labels: Array.isArray(meta.labels) ? meta.labels : [],
    envKeys: Object.keys(env).sort(),
  };
}

/** Full env map for server-side use (compose deploy). Never expose via list API. */
export function getAgentEnvMap(agentId: string): Record<string, string> {
  const row = agentsRepo.findById(agentId);
  if (!row?.metaJson) return {};
  try {
    const meta = JSON.parse(row.metaJson) as { env?: Record<string, string> };
    if (meta.env && typeof meta.env === 'object' && !Array.isArray(meta.env)) {
      return Object.fromEntries(
        Object.entries(meta.env).map(([k, v]) => [String(k), String(v ?? '')]),
      );
    }
  } catch {
    /* ignore */
  }
  return {};
}
