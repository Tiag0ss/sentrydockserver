import { v4 as uuid } from 'uuid';
import { agentsRepo } from '../repositories/agentsRepo';
import { hashToken, randomToken } from './crypto';
import { audit } from './audit';
import { agentGateway } from './agentGateway';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';
import {
  deleteAgentMetrics,
  getAgentMetrics,
  parseMetricsConfig,
} from './metricsService';

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
    const metrics = parseMetricsConfig(meta);
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
      metricsIntervalSec: metrics.metricsIntervalSec,
      metricsRetentionHours: metrics.metricsRetentionHours,
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
  deleteAgentMetrics(id);
  agentsRepo.delete(id);
  await audit({ actor, action: 'agent.deleted', entity: 'agent', entityId: id });
}

export function getAgentContainerMetrics(agentId: string, opts?: { from?: number; to?: number }) {
  const row = agentsRepo.findById(agentId);
  if (!row) throw new AppError(404, 'agent not found', 'not_found');
  return {
    agentId,
    agentName: row.name,
    online: agentGateway.isOnline(agentId),
    ...getAgentMetrics(agentId, opts),
  };
}

export async function listAgentContainers(agentId: string, opts?: { withStats?: boolean }) {
  try {
    return await agentGateway.sendCommand(
      agentId,
      'docker.list',
      { all: true, withStats: Boolean(opts?.withStats) },
      opts?.withStats ? 120_000 : 60_000,
    );
  } catch (err) {
    logger.warn('agent containers failed', { agentId, err: err instanceof Error ? err.message : String(err) });
    throw new AppError(502, 'agent command failed', 'agent_unavailable');
  }
}

export async function controlAgentContainer(
  agentId: string,
  containerId: string,
  action: 'start' | 'stop' | 'restart',
  actor: string,
) {
  if (!containerId.trim()) throw new AppError(400, 'container id required', 'validation');
  const type = action === 'start' ? 'docker.start'
    : action === 'stop' ? 'docker.stop'
      : 'docker.restart';
  try {
    const data = await agentGateway.sendCommand(
      agentId,
      type,
      { id: containerId, timeoutSec: 15 },
      60_000,
    );
    await audit({
      actor,
      action: `agent.container_${action}`,
      entity: 'agent',
      entityId: agentId,
      payload: { containerId, action },
    });
    return data;
  } catch (err) {
    logger.warn('agent container control failed', {
      agentId,
      containerId,
      action,
      err: err instanceof Error ? err.message : String(err),
    });
    throw new AppError(502, err instanceof Error ? err.message : 'agent command failed', 'agent_unavailable');
  }
}

export async function listAgentImageTags(agentId: string, imageRepo: string, secretId?: string | null) {
  if (!imageRepo.trim()) throw new AppError(400, 'imageRepo required', 'validation');
  const { getRegistryAuthForImage } = await import('./imagesService');
  const auth = getRegistryAuthForImage({
    secretId,
    repository: imageRepo,
  });
  try {
    return await agentGateway.sendCommand(
      agentId,
      'image.listTags',
      { imageRepo, ...(auth ? { auth } : {}) },
      120_000,
    );
  } catch (err) {
    logger.warn('agent listTags failed', { agentId, err: err instanceof Error ? err.message : String(err) });
    throw new AppError(502, 'agent command failed', 'agent_unavailable');
  }
}

export async function updateAgentMeta(
  id: string,
  patch: {
    labels?: string[];
    env?: Record<string, string>;
    envUpsert?: Record<string, string>;
    envDelete?: string[];
    metricsIntervalSec?: number;
    metricsRetentionHours?: number;
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

  let metricsChanged = false;
  if (patch.metricsIntervalSec !== undefined) {
    meta.metricsIntervalSec = patch.metricsIntervalSec;
    metricsChanged = true;
  }
  if (patch.metricsRetentionHours !== undefined) {
    meta.metricsRetentionHours = patch.metricsRetentionHours;
    metricsChanged = true;
  }

  // Normalize stored metrics to clamped defaults
  const metrics = parseMetricsConfig(meta);
  meta.metricsIntervalSec = metrics.metricsIntervalSec;
  meta.metricsRetentionHours = metrics.metricsRetentionHours;

  agentsRepo.update(id, { metaJson: JSON.stringify(meta) });

  if (metricsChanged && agentGateway.isOnline(id)) {
    try {
      await agentGateway.pushAgentConfig(id);
    } catch (err) {
      logger.warn('push agent.config after patch failed', {
        agentId: id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    id,
    labels: Array.isArray(meta.labels) ? meta.labels : [],
    envKeys: Object.keys(env).sort(),
    metricsIntervalSec: metrics.metricsIntervalSec,
    metricsRetentionHours: metrics.metricsRetentionHours,
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
