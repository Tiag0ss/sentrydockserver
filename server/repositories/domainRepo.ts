import { and, desc, eq, inArray, isNull, like, lt, or, sql } from 'drizzle-orm';
import { db } from '../database/db';
import {
  flowRuns,
  flowRunSteps,
  flowRunBranches,
  auditLogs,
  updatePolicies,
  updateEvents,
  containerWatches,
  messageTemplates,
  webhookTriggers,
  settings,
  notifications,
} from '../database/schema';

const ACTIVE = ['running', 'waiting_approval', 'awaiting_user', 'resume_pending', 'interrupted'] as const;
const HISTORY = ['success', 'failed', 'aborted', 'rejected'] as const;

export const runsRepo = {
  list(status?: string) {
    let rows = db.select().from(flowRuns).orderBy(desc(flowRuns.startedAt)).all();
    if (status === 'active') rows = rows.filter((r) => (ACTIVE as readonly string[]).includes(r.status));
    else if (status === 'history') rows = rows.filter((r) => (HISTORY as readonly string[]).includes(r.status));
    return rows;
  },
  findById(id: string) {
    return db.select().from(flowRuns).where(eq(flowRuns.id, id)).get();
  },
  steps(runId: string) {
    return db.select().from(flowRunSteps).where(eq(flowRunSteps.runId, runId)).all();
  },
  branches(runId: string) {
    return db.select().from(flowRunBranches).where(eq(flowRunBranches.runId, runId)).all();
  },
  active() {
    return db.select().from(flowRuns).where(inArray(flowRuns.status, [...ACTIVE])).all();
  },
  byStatus(statuses: string[]) {
    return db.select().from(flowRuns).where(inArray(flowRuns.status, statuses)).all();
  },
  insert(row: typeof flowRuns.$inferInsert) {
    db.insert(flowRuns).values(row).run();
  },
  update(id: string, patch: Partial<typeof flowRuns.$inferInsert>) {
    db.update(flowRuns).set(patch).where(eq(flowRuns.id, id)).run();
  },
  activeByLock(lockKey: string) {
    return db.select().from(flowRuns).where(and(
      eq(flowRuns.lockKey, lockKey),
      inArray(flowRuns.status, [...ACTIVE]),
    )).all();
  },
  insertStep(row: typeof flowRunSteps.$inferInsert) {
    db.insert(flowRunSteps).values(row).run();
  },
  updateStep(id: string, patch: Partial<typeof flowRunSteps.$inferInsert>) {
    db.update(flowRunSteps).set(patch).where(eq(flowRunSteps.id, id)).run();
  },
  findStep(runId: string, nodeId: string, branchId: string | null) {
    const rows = db.select().from(flowRunSteps).where(and(
      eq(flowRunSteps.runId, runId),
      eq(flowRunSteps.nodeId, nodeId),
    )).all();
    return rows.find((r) => (r.branchId ?? null) === branchId);
  },
  stepsByStatus(runId: string, status: string) {
    return db.select().from(flowRunSteps).where(and(
      eq(flowRunSteps.runId, runId),
      eq(flowRunSteps.status, status),
    )).all();
  },
  insertBranch(row: typeof flowRunBranches.$inferInsert) {
    db.insert(flowRunBranches).values(row).run();
  },
  updateBranch(id: string, patch: Partial<typeof flowRunBranches.$inferInsert>) {
    db.update(flowRunBranches).set(patch).where(eq(flowRunBranches.id, id)).run();
  },
  branchesBySplit(runId: string, splitNodeId: string) {
    return db.select().from(flowRunBranches).where(and(
      eq(flowRunBranches.runId, runId),
      eq(flowRunBranches.splitNodeId, splitNodeId),
    )).all();
  },
};

export const auditRepo = {
  insert(row: typeof auditLogs.$inferInsert) {
    db.insert(auditLogs).values(row).run();
  },
  list(opts: {
    limit: number;
    flowRunId?: string;
    action?: string;
    actor?: string;
    entity?: string;
    q?: string;
  }) {
    const conditions = [];
    if (opts.flowRunId) conditions.push(eq(auditLogs.flowRunId, opts.flowRunId));
    if (opts.action) conditions.push(eq(auditLogs.action, opts.action));
    if (opts.actor) conditions.push(eq(auditLogs.actor, opts.actor));
    if (opts.entity) conditions.push(eq(auditLogs.entity, opts.entity));
    if (opts.q) {
      const needle = `%${opts.q.replace(/[%_]/g, '')}%`;
      conditions.push(or(
        like(auditLogs.action, needle),
        like(auditLogs.actor, needle),
        like(auditLogs.entity, needle),
        like(auditLogs.entityId, needle),
        like(auditLogs.flowRunId, needle),
        like(auditLogs.payloadJson, needle),
      ));
    }
    const query = db.select().from(auditLogs).orderBy(desc(auditLogs.ts)).limit(opts.limit);
    if (conditions.length) {
      return query.where(and(...conditions)).all();
    }
    return query.all();
  },
  facets() {
    const actions = db.select({ value: auditLogs.action }).from(auditLogs)
      .groupBy(auditLogs.action).orderBy(auditLogs.action).all().map((r) => r.value);
    const actors = db.select({ value: auditLogs.actor }).from(auditLogs)
      .groupBy(auditLogs.actor).orderBy(auditLogs.actor).all().map((r) => r.value);
    const entities = db.select({ value: auditLogs.entity }).from(auditLogs)
      .where(sql`${auditLogs.entity} IS NOT NULL AND ${auditLogs.entity} != ''`)
      .groupBy(auditLogs.entity).orderBy(auditLogs.entity).all()
      .map((r) => r.value).filter(Boolean) as string[];
    return { actions, actors, entities };
  },
  deleteOlderThan(cutoff: Date) {
    db.delete(auditLogs).where(lt(auditLogs.ts, cutoff)).run();
  },
};

export const watchesRepo = {
  list() {
    return db.select().from(containerWatches).all();
  },
  findById(id: string) {
    return db.select().from(containerWatches).where(eq(containerWatches.id, id)).get();
  },
  insert(row: typeof containerWatches.$inferInsert) {
    db.insert(containerWatches).values(row).run();
  },
  update(id: string, patch: Partial<typeof containerWatches.$inferInsert>) {
    db.update(containerWatches).set(patch).where(eq(containerWatches.id, id)).run();
  },
  delete(id: string) {
    db.delete(containerWatches).where(eq(containerWatches.id, id)).run();
  },
};

export const policiesRepo = {
  list() {
    return db.select().from(updatePolicies).all();
  },
  listEnabled() {
    return db.select().from(updatePolicies).where(eq(updatePolicies.enabled, true)).all();
  },
  findById(id: string) {
    return db.select().from(updatePolicies).where(eq(updatePolicies.id, id)).get();
  },
  insert(row: typeof updatePolicies.$inferInsert) {
    db.insert(updatePolicies).values(row).run();
  },
  update(id: string, patch: Partial<typeof updatePolicies.$inferInsert>) {
    db.update(updatePolicies).set(patch).where(eq(updatePolicies.id, id)).run();
  },
  delete(id: string) {
    db.delete(updatePolicies).where(eq(updatePolicies.id, id)).run();
  },
};

export const updateEventsRepo = {
  list() {
    return db.select().from(updateEvents).orderBy(desc(updateEvents.createdAt)).all();
  },
  listPending() {
    return db.select().from(updateEvents).where(eq(updateEvents.status, 'pending')).all();
  },
  findById(id: string) {
    return db.select().from(updateEvents).where(eq(updateEvents.id, id)).get();
  },
  insert(row: typeof updateEvents.$inferInsert) {
    db.insert(updateEvents).values(row).run();
  },
  update(id: string, patch: Partial<typeof updateEvents.$inferInsert>) {
    db.update(updateEvents).set(patch).where(eq(updateEvents.id, id)).run();
  },
};

export const templatesRepo = {
  list() {
    return db.select().from(messageTemplates).all();
  },
  findByKey(key: string) {
    return db.select().from(messageTemplates).where(eq(messageTemplates.key, key)).get();
  },
  insert(row: typeof messageTemplates.$inferInsert) {
    db.insert(messageTemplates).values(row).run();
  },
  update(id: string, patch: Partial<typeof messageTemplates.$inferInsert>) {
    db.update(messageTemplates).set(patch).where(eq(messageTemplates.id, id)).run();
  },
  delete(id: string) {
    db.delete(messageTemplates).where(eq(messageTemplates.id, id)).run();
  },
};

export const webhooksRepo = {
  listMeta() {
    return db.select({
      id: webhookTriggers.id,
      name: webhookTriggers.name,
      flowId: webhookTriggers.flowId,
      agentId: webhookTriggers.agentId,
      enabled: webhookTriggers.enabled,
      createdAt: webhookTriggers.createdAt,
    }).from(webhookTriggers).all();
  },
  findById(id: string) {
    return db.select().from(webhookTriggers).where(eq(webhookTriggers.id, id)).get();
  },
  insert(row: typeof webhookTriggers.$inferInsert) {
    db.insert(webhookTriggers).values(row).run();
  },
  update(id: string, patch: Partial<{
    name: string;
    flowId: string;
    agentId: string | null;
    enabled: boolean;
    tokenHash: string;
  }>) {
    db.update(webhookTriggers).set(patch).where(eq(webhookTriggers.id, id)).run();
  },
  delete(id: string) {
    db.delete(webhookTriggers).where(eq(webhookTriggers.id, id)).run();
  },
};

export const settingsRepo = {
  list() {
    return db.select().from(settings).all();
  },
  get(key: string) {
    return db.select().from(settings).where(eq(settings.key, key)).get();
  },
  upsert(key: string, value: string) {
    const existing = db.select().from(settings).where(eq(settings.key, key)).get();
    if (existing) db.update(settings).set({ value }).where(eq(settings.key, key)).run();
    else db.insert(settings).values({ key, value }).run();
  },
};

export const notificationsRepo = {
  insert(row: typeof notifications.$inferInsert) {
    db.insert(notifications).values(row).run();
  },
  list(limit = 50, opts?: { unreadOnly?: boolean }) {
    if (opts?.unreadOnly) {
      return db.select().from(notifications)
        .where(isNull(notifications.readAt))
        .orderBy(desc(notifications.ts))
        .limit(limit)
        .all();
    }
    return db.select().from(notifications)
      .orderBy(desc(notifications.ts))
      .limit(limit)
      .all();
  },
  findById(id: string) {
    return db.select().from(notifications).where(eq(notifications.id, id)).get();
  },
  unreadCount() {
    const row = db.select({ n: sql<number>`count(*)` })
      .from(notifications)
      .where(isNull(notifications.readAt))
      .get();
    return Number(row?.n ?? 0);
  },
  markRead(id: string) {
    db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id)).run();
  },
  markAllRead() {
    db.update(notifications).set({ readAt: new Date() }).where(isNull(notifications.readAt)).run();
  },
  deleteOlderThan(cutoff: Date) {
    db.delete(notifications).where(lt(notifications.ts, cutoff)).run();
  },
};
