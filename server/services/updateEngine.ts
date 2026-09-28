import cron from 'node-cron';
import { v4 as uuid } from 'uuid';
import { nextCronDate, inBlackout } from './cronUtils';
import { agentGateway } from './agentGateway';
import { startFlowRun } from './flowEngine';
import { getRegistryAuth } from './imagesService';
import { audit } from './audit';
import logger from '../utils/logger';
import {
  policiesRepo, watchesRepo, updateEventsRepo, settingsRepo, auditRepo, notificationsRepo,
} from '../repositories/domainRepo';
import { flowsRepo } from '../repositories/flowsRepo';

function migratePoliciesToFlowSchedules() {
  let migrated = 0;
  for (const policy of policiesRepo.list()) {
    if (!policy.enabled || !policy.cron) continue;
    const flow = flowsRepo.findById(policy.flowId);
    if (!flow) {
      policiesRepo.update(policy.id, { enabled: false });
      continue;
    }
    if (!flow.scheduleEnabled) {
      let next: Date | null = null;
      try {
        next = nextCronDate(policy.cron, policy.timezone || 'Europe/Lisbon', new Date());
      } catch {
        next = null;
      }
      flowsRepo.update(flow.id, {
        scheduleEnabled: true,
        cron: policy.cron,
        timezone: policy.timezone || 'Europe/Lisbon',
        blackoutStart: policy.blackoutStart,
        blackoutEnd: policy.blackoutEnd,
        nextRunAt: next,
        updatedAt: new Date(),
      });
      migrated += 1;
    }
    // Desactivar policy legado para não duplicar tick / agenda
    policiesRepo.update(policy.id, { enabled: false });
  }
  if (migrated) logger.info('migrated policies to flow schedules', { migrated });
  return migrated;
}

export function scheduleUpdateEngine() {
  try {
    migratePoliciesToFlowSchedules();
  } catch (e) {
    logger.warn('policy→flow schedule migration skipped', {
      err: e instanceof Error ? e.message : String(e),
    });
  }
  cron.schedule('* * * * *', () => {
    void tickFlowSchedules();
    void tickPolicies();
    void retainLogs();
  });
  logger.info('Update engine cron started');
}

async function tickFlowSchedules() {
  const now = new Date();
  for (const flow of flowsRepo.listScheduled()) {
    if (!flow.cron) continue;
    if (!flow.nextRunAt) {
      const next = nextCronDate(flow.cron, flow.timezone || 'Europe/Lisbon', now);
      flowsRepo.update(flow.id, { nextRunAt: next, updatedAt: now });
      continue;
    }
    const due = flow.nextRunAt instanceof Date ? flow.nextRunAt : new Date(flow.nextRunAt);
    if (due.getTime() > now.getTime()) continue;

    const next = nextCronDate(flow.cron, flow.timezone || 'Europe/Lisbon', now);
    flowsRepo.update(flow.id, {
      lastRunAt: now,
      nextRunAt: next,
      updatedAt: now,
    });

    if (inBlackout(flow.timezone || 'Europe/Lisbon', flow.blackoutStart, flow.blackoutEnd, now)) {
      await audit({
        actor: 'system',
        action: 'flow.schedule_blackout_skip',
        entity: 'flow',
        entityId: flow.id,
      });
      continue;
    }

    try {
      await startFlowRun({
        flowId: flow.id,
        triggerSource: 'cron',
        actor: 'system',
        lockKey: `flow:${flow.id}`,
      });
    } catch (e) {
      logger.error('scheduled flow start failed', {
        flowId: flow.id,
        err: e instanceof Error ? e.message : String(e),
      });
      await audit({
        actor: 'system',
        action: 'flow.schedule_failed',
        entity: 'flow',
        entityId: flow.id,
        payload: { error: e instanceof Error ? e.message : String(e) },
      });
    }
  }
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

  const auth = watch.secretId ? getRegistryAuth(watch.secretId) : undefined;

  const check = await agentGateway.sendCommand(watch.agentId, 'image.checkUpdate', {
    id: watch.containerName,
    containerId: watch.containerName,
    image: watch.image,
    auth,
  }, 300_000) as {
    updateAvailable?: boolean;
    remoteDigest?: string;
    localDigests?: string[];
    imageId?: string;
  };

  const oldDigest = check.localDigests?.[0] || check.imageId || '';
  const newDigest = check.remoteDigest || '';
  const updateAvailable = Boolean(check.updateAvailable);

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
    targets: [{
      agentId: watch.agentId,
      containerName: watch.containerName,
      image: watch.image,
      oldDigest,
      newDigest,
    }],
    lastOutcome: 'update',
    lastResult: true,
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
