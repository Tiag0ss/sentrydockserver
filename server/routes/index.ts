import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authRequired, requireModify, requirePasswordOk } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { param } from '../utils/params';
import {
  loginSchema,
  createUserSchema,
  updateUserSchema,
  changePasswordSchema,
  createAgentSchema,
  createSecretSchema,
  createFlowSchema,
  updateFlowSchema,
  runFlowSchema,
  continueRunSchema,
  rerunRunSchema,
  createWatchSchema,
  createPolicySchema,
  createTemplateSchema,
  createWebhookTriggerSchema,
  updateSettingSchema,
} from '../validation/schemas';
import * as authService from '../services/authService';
import * as agentsService from '../services/agentsService';
import * as secretsService from '../services/secretsService';
import * as flowsService from '../services/flowsService';
import * as ops from '../services/opsService';

export const apiRouter = Router();

const loginLimiter = rateLimit({ windowMs: 60_000, max: 20 });
const hookLimiter = rateLimit({ windowMs: 60_000, max: 60 });

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'sentrydock-server' });
});

apiRouter.post('/auth/login', loginLimiter, validateBody(loginSchema), asyncHandler(async (req, res) => {
  const result = await authService.login(req.body.username, req.body.password);
  res.cookie?.('token', result.token, { httpOnly: true, sameSite: 'lax' });
  res.json(result);
}));

apiRouter.get('/auth/me', authRequired, (req, res) => {
  res.json(authService.getMe(req.user!.id));
});

apiRouter.post('/auth/change-password', authRequired, validateBody(changePasswordSchema), asyncHandler(async (req, res) => {
  const result = await authService.changeOwnPassword(req.user!.id, req.body);
  res.cookie?.('token', result.token, { httpOnly: true, sameSite: 'lax' });
  res.json(result);
}));

apiRouter.get('/users', authRequired, requirePasswordOk, requireModify, (_req, res) => {
  res.json(authService.listUsers());
});

apiRouter.post('/users', authRequired, requirePasswordOk, requireModify, validateBody(createUserSchema), asyncHandler(async (req, res) => {
  const result = await authService.createUser(req.body, req.user!.username);
  res.status(201).json(result);
}));

apiRouter.patch('/users/:id', authRequired, requirePasswordOk, requireModify, validateBody(updateUserSchema), asyncHandler(async (req, res) => {
  const result = await authService.updateUser(param(req), req.body, req.user!);
  res.json(result);
}));

apiRouter.delete('/users/:id', authRequired, requirePasswordOk, requireModify, asyncHandler(async (req, res) => {
  const result = await authService.deleteUser(param(req), req.user!);
  res.json(result);
}));

apiRouter.get('/agents', authRequired, requirePasswordOk, (_req, res) => {
  res.json(agentsService.listAgents());
});

apiRouter.post('/agents', authRequired, requirePasswordOk, requireModify, validateBody(createAgentSchema), asyncHandler(async (req, res) => {
  const result = await agentsService.createAgent(req.body, req.user!.username);
  res.status(201).json(result);
}));

apiRouter.delete('/agents/:id', authRequired, requirePasswordOk, requireModify, asyncHandler(async (req, res) => {
  await agentsService.deleteAgent(param(req), req.user!.username);
  res.json({ ok: true });
}));

apiRouter.get('/agents/:id/containers', authRequired, requirePasswordOk, asyncHandler(async (req, res) => {
  const data = await agentsService.listAgentContainers(param(req));
  res.json(data);
}));

apiRouter.get('/secrets', authRequired, requirePasswordOk, (_req, res) => {
  res.json(secretsService.listSecrets());
});

apiRouter.post('/secrets', authRequired, requirePasswordOk, requireModify, validateBody(createSecretSchema), asyncHandler(async (req, res) => {
  const result = await secretsService.createSecret(req.body, req.user!.username);
  res.status(201).json(result);
}));

apiRouter.delete('/secrets/:id', authRequired, requirePasswordOk, requireModify, asyncHandler(async (req, res) => {
  await secretsService.deleteSecret(param(req), req.user!.username);
  res.json({ ok: true });
}));

apiRouter.get('/flows', authRequired, requirePasswordOk, (_req, res) => {
  res.json(flowsService.listFlows());
});

apiRouter.post('/flows', authRequired, requirePasswordOk, requireModify, validateBody(createFlowSchema), asyncHandler(async (req, res) => {
  const result = await flowsService.createFlow(req.body, req.user!.username);
  res.status(201).json(result);
}));

apiRouter.put('/flows/:id', authRequired, requirePasswordOk, requireModify, validateBody(updateFlowSchema), asyncHandler(async (req, res) => {
  await flowsService.updateFlow(param(req), req.body, req.user!.username);
  res.json({ ok: true });
}));

apiRouter.delete('/flows/:id', authRequired, requirePasswordOk, requireModify, asyncHandler(async (req, res) => {
  await flowsService.deleteFlow(param(req), req.user!.username);
  res.json({ ok: true });
}));

apiRouter.get('/flows/:id/export', authRequired, requirePasswordOk, asyncHandler(async (req, res) => {
  res.json(flowsService.exportFlow(param(req)));
}));

apiRouter.post('/flows/import', authRequired, requirePasswordOk, requireModify, validateBody(createFlowSchema), asyncHandler(async (req, res) => {
  const result = await flowsService.importFlow(req.body, req.user!.username);
  res.status(201).json(result);
}));

apiRouter.post('/flows/:id/run', authRequired, requirePasswordOk, requireModify, validateBody(runFlowSchema), asyncHandler(async (req, res) => {
  const result = await flowsService.runFlow(param(req), req.body, req.user!.username);
  res.status(201).json(result);
}));

apiRouter.get('/runs', authRequired, requirePasswordOk, (req, res) => {
  res.json(ops.listRuns(req.query.status as string | undefined));
});

apiRouter.get('/runs/:id', authRequired, requirePasswordOk, asyncHandler(async (req, res) => {
  res.json(ops.getRun(param(req)));
}));

apiRouter.post('/runs/:id/continue', authRequired, requirePasswordOk, requireModify, validateBody(continueRunSchema), asyncHandler(async (req, res) => {
  await ops.continueRun(param(req), req.body);
  res.json({ ok: true });
}));

apiRouter.post('/runs/:id/rerun', authRequired, requirePasswordOk, requireModify, validateBody(rerunRunSchema), asyncHandler(async (req, res) => {
  const result = await ops.rerunRun(param(req), req.user!.username, req.body);
  res.status(201).json(result);
}));

apiRouter.get('/watches', authRequired, requirePasswordOk, (_req, res) => {
  res.json(ops.listWatches());
});

apiRouter.post('/watches', authRequired, requirePasswordOk, requireModify, validateBody(createWatchSchema), (req, res) => {
  res.status(201).json(ops.createWatch(req.body));
});

apiRouter.get('/policies', authRequired, requirePasswordOk, (_req, res) => {
  res.json(ops.listPolicies());
});

apiRouter.post('/policies', authRequired, requirePasswordOk, requireModify, validateBody(createPolicySchema), (req, res) => {
  res.status(201).json(ops.createPolicy(req.body));
});

apiRouter.post('/policies/:id/check', authRequired, requirePasswordOk, requireModify, asyncHandler(async (req, res) => {
  res.json(await ops.checkPolicy(param(req)));
}));

apiRouter.get('/update-events', authRequired, requirePasswordOk, (_req, res) => {
  res.json(ops.listUpdateEvents());
});

apiRouter.post('/update-events/:id/approve', authRequired, requirePasswordOk, requireModify, asyncHandler(async (req, res) => {
  res.json(await ops.approveUpdateEvent(param(req), req.user!.username));
}));

apiRouter.get('/templates', authRequired, requirePasswordOk, (_req, res) => {
  res.json(ops.listTemplates());
});

apiRouter.post('/templates', authRequired, requirePasswordOk, requireModify, validateBody(createTemplateSchema), (req, res) => {
  res.status(201).json(ops.createTemplate(req.body));
});

apiRouter.get('/webhook-triggers', authRequired, requirePasswordOk, (_req, res) => {
  res.json(ops.listWebhookTriggers());
});

apiRouter.post('/webhook-triggers', authRequired, requirePasswordOk, requireModify, validateBody(createWebhookTriggerSchema), (req, res) => {
  res.status(201).json(ops.createWebhookTrigger(req.body));
});

apiRouter.post('/hooks/:id', hookLimiter, asyncHandler(async (req, res) => {
  const token = String(req.headers['x-sentrydock-token'] || req.query.token || '');
  const result = await ops.handleInboundWebhook(param(req), token, (req.body || {}) as Record<string, unknown>);
  res.status(202).json(result);
}));

apiRouter.get('/logs', authRequired, requirePasswordOk, (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 500);
  res.json(ops.listLogs(limit, req.query.flowRunId as string | undefined));
});

apiRouter.get('/notifications', authRequired, requirePasswordOk, (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const unreadOnly = String(req.query.unread || '') === '1' || String(req.query.unread || '') === 'true';
  res.json({
    items: ops.listNotifications(limit, unreadOnly),
    unreadCount: ops.unreadNotificationCount(),
  });
});

apiRouter.post('/notifications/read-all', authRequired, requirePasswordOk, (_req, res) => {
  ops.markAllNotificationsRead();
  res.json({ ok: true });
});

apiRouter.post('/notifications/:id/read', authRequired, requirePasswordOk, (req, res) => {
  const ok = ops.markNotificationRead(param(req));
  if (!ok) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ok: true });
});

apiRouter.get('/dashboard', authRequired, requirePasswordOk, (_req, res) => {
  res.json(ops.getDashboard());
});

apiRouter.get('/settings', authRequired, requirePasswordOk, requireModify, (_req, res) => {
  res.json(ops.listSettings());
});

apiRouter.put('/settings/:key', authRequired, requirePasswordOk, requireModify, validateBody(updateSettingSchema), (req, res) => {
  ops.updateSetting(param(req, 'key'), req.body.value);
  res.json({ ok: true });
});
