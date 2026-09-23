import cron from 'node-cron';
import { v4 as uuid } from 'uuid';
import { nextCronDate, inBlackout } from './cronUtils';
import { agentGateway } from './agentGateway';
import { startFlowRun } from './flowEngine';
import { getSecretPlain } from './secretsService';
import { audit } from './audit';
import logger from '../utils/logger';
import { policiesRepo, watchesRepo, updateEventsRepo, settingsRepo, auditRepo, notificationsRepo } from '../repositories/domainRepo';

export function scheduleUpdateEngine() {
  // Tick every minute
  cron.schedule('* * * * *', () => {
    void tickPolicies();
    void retainLogs();
  });
  logger.info('Update engine cron started');
}

async function tickPolicies() {
  const now = new Date();
  const policies = policiesRepo.listEnabled();
  for (const policy of policies) {
    if (!policy.nextRunAt) {
      const next = nextCronDate(policy.cron, policy.timezone, now);
      policiesRepo.update(policy.id, { nextRunAt: next });
      continue;
    }
    if (policy.nextRunAt.getTime() > now.getTime()) continue;

    const next = nextCronDate(policy.cron, policy.timezone, now);
    policiesRepo.update(policy.id, { lastRunAt: now, nextRunAt: next });

    if (inBlackout(policy.timezone, policy.blackoutStart, policy.blackoutEnd, now)) {
      await audit({
        actor: 'system',
        action: 'policy.blackout_skip',
        entity: 'update_policy',
        entityId: policy.id,
      });
      continue;
    }

    try {
      await runPolicyCheck(policy.id);
    } catch (e) {
      logger.error('policy check failed', { policyId: policy.id, err: e });
      await audit({
        actor: 'system',
        action: 'policy.check_failed',
        entity: 'update_policy',
        entityId: policy.id,
        payload: { error: e instanceof Error ? e.message : String(e) },
      });
    }
  }
}

export async function runPolicyCheck(policyId: string) {
  const policy = policiesRepo.findById(policyId);
  if (!policy) throw new Error('Policy not found');
  const watch = watchesRepo.findById(policy.watchId);
  if (!watch) throw new Error('Watch not found');

  let auth;
  if (watch.secretId) {
    const plain = getSecretPlain(watch.secretId);
    if (plain) {
      try { auth = JSON.parse(plain); } catch (err) { logger.warn('bad secret json', { secretId: watch.secretId }); }
    }
  }

  const local = await agentGateway.sendCommand(watch.agentId, 'docker.inspect', {
    id: watch.containerName,
  }) as { Image?: string; Id?: string };

  const remote = await agentGateway.sendCommand(watch.agentId, 'image.digest', {
    image: watch.image,
    auth,
  }) as { digest?: string };

  const oldDigest = local.Image || local.Id || '';
  const newDigest = remote.digest || '';
  const updateAvailable = Boolean(newDigest && oldDigest && !String(oldDigest).includes(String(newDigest).replace(/^sha256:/, '')));

  await audit({
    actor: 'system',
    action: 'policy.checked',
    entity: 'update_policy',
    entityId: policy.id,
    payload: { updateAvailable, oldDigest, newDigest, image: watch.image },
  });

  if (!updateAvailable) return { updateAvailable: false };

  const eventId = uuid();
  updateEventsRepo.insert({
      id: eventId,
      policyId: policy.id,
      watchId: watch.id,
      status: policy.mode === 'auto' ? 'executed' : 'pending',
      oldDigest,
      newDigest,
      image: watch.image,
      createdAt: new Date(),
      resolvedAt: policy.mode === 'auto' ? new Date() : null,
    });

  const ctx = {
    agentId: watch.agentId,
    containerName: watch.containerName,
    image: watch.image,
    secretId: watch.secretId,
    oldDigest,
    newDigest,
    updateAvailable: true,
    policyId: policy.id,
  };

  if (policy.mode === 'auto') {
    const runId = await startFlowRun({
      flowId: policy.flowId,
      triggerSource: 'cron',
      context: ctx,
      lockKey: `watch:${watch.id}`,
      actor: 'system',
    });
    return { updateAvailable: true, runId };
  }

  return { updateAvailable: true, eventId };
}

async function retainLogs() {
  const row = settingsRepo.get('log_retention_days');
  const days = Number(row?.value || process.env.LOG_RETENTION_DAYS || 90);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  auditRepo.deleteOlderThan(cutoff);
  notificationsRepo.deleteOlderThan(cutoff);
}
