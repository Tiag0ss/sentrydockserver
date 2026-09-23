import { v4 as uuid } from 'uuid';
import { agentsRepo } from '../repositories/agentsRepo';
import { hashToken, randomToken } from './crypto';
import { audit } from './audit';
import { agentGateway } from './agentGateway';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

export function listAgents() {
  return agentsRepo.list().map((r) => ({
    ...r,
    online: agentGateway.isOnline(r.id),
    meta: r.metaJson ? JSON.parse(r.metaJson) : null,
  }));
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
