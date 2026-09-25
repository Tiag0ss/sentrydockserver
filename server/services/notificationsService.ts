import { v4 as uuid } from 'uuid';
import { notificationsRepo, runsRepo } from '../repositories/domainRepo';
import { flowsRepo } from '../repositories/flowsRepo';
import { audit } from './audit';
import { uiBus } from './uiBus';
import {
  agentNameMap,
  displayImageLabel,
  humanizeDisplayText,
  resolveAgentName,
} from '../utils/displayHumanize';

export type NotifyLevel = 'info' | 'warn' | 'error';

function inferLevel(message: string, ctx: Record<string, unknown>, explicit?: string): NotifyLevel {
  if (explicit === 'info' || explicit === 'warn' || explicit === 'error') return explicit;
  if (ctx.error || ctx.lastError || /error|fail|rejected/i.test(message)) return 'error';
  if (ctx.approvalDecision === 'rejected') return 'warn';
  return 'info';
}

function toPublicNotification(row: {
  id: string;
  ts: Date;
  message: string;
  level: string;
  flowRunId: string | null;
  flowId: string | null;
  flowName: string | null;
  agentId: string | null;
  containerName: string | null;
  image: string | null;
  readAt: Date | null;
  payloadJson?: string | null;
}, names?: Map<string, string>) {
  const map = names || agentNameMap();
  return {
    id: row.id,
    ts: row.ts,
    message: humanizeDisplayText(row.message, map),
    level: row.level,
    flowRunId: row.flowRunId,
    flowId: row.flowId,
    flowName: row.flowName,
    agentId: row.agentId,
    agentName: resolveAgentName(row.agentId, map),
    containerName: row.containerName,
    image: displayImageLabel(row.image),
    readAt: row.readAt,
    payload: row.payloadJson ? JSON.parse(row.payloadJson) : null,
  };
}

export function createNotification(input: {
  message: string;
  flowRunId?: string;
  level?: string;
  ctx?: Record<string, unknown>;
}) {
  const ctx = input.ctx || {};
  const run = input.flowRunId ? runsRepo.findById(input.flowRunId) : null;
  const flow = run ? flowsRepo.findById(run.flowId) : null;
  const names = agentNameMap();
  const message = humanizeDisplayText(input.message, names);
  const level = inferLevel(message, ctx, input.level);
  const id = uuid();
  const ts = new Date();
  const row = {
    id,
    ts,
    message,
    level,
    flowRunId: input.flowRunId ?? null,
    flowId: run?.flowId ?? (ctx.flowId ? String(ctx.flowId) : null),
    flowName: flow?.name ?? null,
    agentId: ctx.agentId != null ? String(ctx.agentId) : null,
    containerName: ctx.containerName != null ? String(ctx.containerName) : null,
    image: ctx.image != null ? String(ctx.image) : null,
    readAt: null as Date | null,
    payloadJson: JSON.stringify({
      approvalDecision: ctx.approvalDecision,
      failedNodeType: ctx.failedNodeType,
      error: ctx.error || ctx.lastError,
    }),
  };
  notificationsRepo.insert(row);

  void audit({
    actor: 'system',
    action: 'notify',
    entity: 'notification',
    entityId: id,
    flowRunId: input.flowRunId,
    payload: { message, level },
  });

  const publicRow = toPublicNotification(row, names);
  uiBus.emit('notification', publicRow);
  return publicRow;
}

export function listNotifications(limit = 50, unreadOnly = false) {
  const names = agentNameMap();
  return notificationsRepo.list(limit, { unreadOnly }).map((r) => toPublicNotification(r, names));
}

export function unreadNotificationCount() {
  return notificationsRepo.unreadCount();
}

export function markNotificationRead(id: string) {
  const row = notificationsRepo.findById(id);
  if (!row) return false;
  notificationsRepo.markRead(id);
  return true;
}

export function markAllNotificationsRead() {
  notificationsRepo.markAllRead();
}
