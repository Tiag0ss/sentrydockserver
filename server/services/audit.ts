import { v4 as uuid } from 'uuid';
import { auditRepo } from '../repositories/domainRepo';

export async function audit(input: {
  actor: string;
  action: string;
  entity?: string;
  entityId?: string;
  flowRunId?: string;
  payload?: unknown;
}) {
  auditRepo.insert({
    id: uuid(),
    ts: new Date(),
    actor: input.actor,
    action: input.action,
    entity: input.entity ?? null,
    entityId: input.entityId ?? null,
    flowRunId: input.flowRunId ?? null,
    payloadJson: input.payload ? JSON.stringify(input.payload) : null,
  });
}
