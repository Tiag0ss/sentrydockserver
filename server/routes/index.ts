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
  updateSecretSchema,
  createFlowSchema,
  updateFlowSchema,
  runFlowSchema,
  continueRunSchema,
  rerunRunSchema,
  createWatchSchema,
  createPolicySchema,
  updateWatchSchema,
  updatePolicySchema,
  createTemplateSchema,
  updateTemplateSchema,
  updateAgentSchema,
  importBundleSchema,
  createWebhookTriggerSchema,
  updateWebhookTriggerSchema,
  updateSettingSchema,
  createComposeProjectSchema,
  updateComposeProjectSchema,
  deployComposeSchema,
  checkComposeSchema,
  createDockerImageSchema,
  updateDockerImageSchema,
} from '../validation/schemas';
import * as authService from '../services/authService';
import * as agentsService from '../services/agentsService';
import * as secretsService from '../services/secretsService';
import * as flowsService from '../services/flowsService';
import * as ops from '../services/opsService';
import * as imagesService from '../services/imagesService';
import * as composeService from '../services/composeService';

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

apiRouter.patch('/agents/:id', authRequired, requirePasswordOk, requireModify, validateBody(updateAgentSchema), (req, res) => {
  res.json(agentsService.updateAgentMeta(param(req), {
    labels: req.body.labels,
    env: req.body.env,
    envUpsert: req.body.envUpsert,
    envDelete: req.body.envDelete,
  }));
});

apiRouter.get('/agents/:id/containers', authRequired, requirePasswordOk, asyncHandler(async (req, res) => {
  const data = await agentsService.listAgentContainers(param(req));
  res.json(data);
}));

apiRouter.get('/agents/:id/image-tags', authRequired, requirePasswordOk, asyncHandler(async (req, res) => {
  const imageRepo = String(req.query.imageRepo || req.query.image || '');
  const secretId = req.query.secretId ? String(req.query.secretId) : null;
  const data = await agentsService.listAgentImageTags(param(req), imageRepo, secretId);
  res.json(data);
}));

apiRouter.get('/secrets', authRequired, requirePasswordOk, (_req, res) => {
  res.json(secretsService.listSecrets());
});

apiRouter.post('/secrets', authRequired, requirePasswordOk, requireModify, validateBody(createSecretSchema), asyncHandler(async (req, res) => {
  const result = await secretsService.createSecret(req.body, req.user!.username);
  res.status(201).json(result);
}));

apiRouter.patch('/secrets/:id', authRequired, requirePasswordOk, requireModify, validateBody(updateSecretSchema), asyncHandler(async (req, res) => {
  res.json(await secretsService.updateSecret(param(req), req.body, req.user!.username));
}));

apiRouter.delete('/secrets/:id', authRequired, requirePasswordOk, requireModify, asyncHandler(async (req, res) => {
  await secretsService.deleteSecret(param(req), req.user!.username);
  res.json({ ok: true });
}));

apiRouter.get('/flows', authRequired, requirePasswordOk, (_req, res) => {
  res.json(flowsService.listFlows());
});

apiRouter.get('/flows/:id', authRequired, requirePasswordOk, (req, res) => {
  res.json(flowsService.getFlow(param(req)));
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

apiRouter.post('/flows/:id/duplicate', authRequired, requirePasswordOk, requireModify, asyncHandler(async (req, res) => {
  const result = await flowsService.duplicateFlow(param(req), req.user!.username);
  res.status(201).json(result);
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

apiRouter.patch('/watches/:id', authRequired, requirePasswordOk, requireModify, validateBody(updateWatchSchema), (req, res) => {
  res.json(ops.updateWatch(param(req), req.body));
});

apiRouter.delete('/watches/:id', authRequired, requirePasswordOk, requireModify, (req, res) => {
  res.json(ops.deleteWatch(param(req)));
});

apiRouter.get('/policies', authRequired, requirePasswordOk, (_req, res) => {
  res.json(ops.listPolicies());
});

apiRouter.post('/policies', authRequired, requirePasswordOk, requireModify, validateBody(createPolicySchema), (req, res) => {
  res.status(201).json(ops.createPolicy(req.body));
});

apiRouter.patch('/policies/:id', authRequired, requirePasswordOk, requireModify, validateBody(updatePolicySchema), (req, res) => {
  res.json(ops.updatePolicy(param(req), req.body));
});

apiRouter.delete('/policies/:id', authRequired, requirePasswordOk, requireModify, (req, res) => {
  res.json(ops.deletePolicy(param(req)));
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

apiRouter.patch('/templates/:id', authRequired, requirePasswordOk, requireModify, validateBody(updateTemplateSchema), (req, res) => {
  res.json(ops.updateTemplate(param(req), req.body));
});

apiRouter.delete('/templates/:id', authRequired, requirePasswordOk, requireModify, (req, res) => {
  res.json(ops.deleteTemplate(param(req)));
});

apiRouter.get('/ops/export', authRequired, requirePasswordOk, requireModify, (_req, res) => {
  res.json(ops.exportOpsBundle());
});

apiRouter.post('/ops/import', authRequired, requirePasswordOk, requireModify, validateBody(importBundleSchema), (req, res) => {
  res.json(ops.importOpsBundle(req.body));
});

apiRouter.get('/webhook-triggers', authRequired, requirePasswordOk, (_req, res) => {
  res.json(ops.listWebhookTriggers());
});

apiRouter.post('/webhook-triggers', authRequired, requirePasswordOk, requireModify, validateBody(createWebhookTriggerSchema), (req, res) => {
  res.status(201).json(ops.createWebhookTrigger(req.body));
});

apiRouter.patch('/webhook-triggers/:id', authRequired, requirePasswordOk, requireModify, validateBody(updateWebhookTriggerSchema), (req, res) => {
  res.json(ops.updateWebhookTrigger(param(req), req.body));
});

apiRouter.post('/webhook-triggers/:id/reset-token', authRequired, requirePasswordOk, requireModify, (req, res) => {
  res.json(ops.resetWebhookTriggerToken(param(req)));
});

apiRouter.delete('/webhook-triggers/:id', authRequired, requirePasswordOk, requireModify, (req, res) => {
  res.json(ops.deleteWebhookTrigger(param(req)));
});

apiRouter.post('/hooks/:id', hookLimiter, asyncHandler(async (req, res) => {
  const token = String(req.headers['x-sentrydock-token'] || req.query.token || '');
  const result = await ops.handleInboundWebhook(param(req), token, (req.body || {}) as Record<string, unknown>);
  res.status(202).json(result);
}));

apiRouter.get('/logs', authRequired, requirePasswordOk, (req, res) => {
  const limit = Math.min(Number(req.query.limit || 200), 500);
  res.json(ops.listLogs({
    limit,
    flowRunId: req.query.flowRunId ? String(req.query.flowRunId) : undefined,
    action: req.query.action ? String(req.query.action) : undefined,
    actor: req.query.actor ? String(req.query.actor) : undefined,
    entity: req.query.entity ? String(req.query.entity) : undefined,
    q: req.query.q ? String(req.query.q) : undefined,
  }));
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

apiRouter.get('/compose-projects', authRequired, requirePasswordOk, (_req, res) => {
  res.json(composeService.listComposeProjects());
});

apiRouter.get('/compose-projects/:id', authRequired, requirePasswordOk, (req, res) => {
  res.json(composeService.getComposeProject(param(req)));
});

apiRouter.post('/compose-projects', authRequired, requirePasswordOk, requireModify, validateBody(createComposeProjectSchema), asyncHandler(async (req, res) => {
  const row = await composeService.createComposeProject(req.body, req.user!.username);
  res.status(201).json(row);
}));

apiRouter.put('/compose-projects/:id', authRequired, requirePasswordOk, requireModify, validateBody(updateComposeProjectSchema), asyncHandler(async (req, res) => {
  res.json(await composeService.updateComposeProject(param(req), req.body, req.user!.username));
}));

apiRouter.delete('/compose-projects/:id', authRequired, requirePasswordOk, requireModify, asyncHandler(async (req, res) => {
  res.json(await composeService.deleteComposeProject(param(req), req.user!.username));
}));

apiRouter.post('/compose-projects/:id/duplicate', authRequired, requirePasswordOk, requireModify, asyncHandler(async (req, res) => {
  res.status(201).json(await composeService.duplicateComposeProject(param(req), req.user!.username));
}));

apiRouter.post('/compose-projects/:id/deploy', authRequired, requirePasswordOk, requireModify, validateBody(deployComposeSchema), asyncHandler(async (req, res) => {
  res.json(await composeService.deployComposeProject(param(req), req.body, req.user!.username));
}));

apiRouter.post('/compose-projects/:id/check', authRequired, requirePasswordOk, requireModify, validateBody(checkComposeSchema), asyncHandler(async (req, res) => {
  res.json(await composeService.checkComposeProject(param(req), req.body.agentIds));
}));

apiRouter.post('/compose-projects/:id/create-update-flow', authRequired, requirePasswordOk, requireModify, asyncHandler(async (req, res) => {
  res.json(await composeService.createUpdateFlowFromCompose(param(req), req.user!.username));
}));

apiRouter.get('/docker-images', authRequired, requirePasswordOk, (_req, res) => {
  res.json(imagesService.listDockerImages());
});

apiRouter.get('/docker-images/:id/running-containers', authRequired, requirePasswordOk, asyncHandler(async (req, res) => {
  res.json(await imagesService.listRunningContainersForImage(param(req)));
}));

apiRouter.post('/docker-images/sync', authRequired, requirePasswordOk, requireModify, asyncHandler(async (req, res) => {
  const agentIds = Array.isArray(req.body?.agentIds) ? req.body.agentIds.map(String) : undefined;
  res.json(await imagesService.syncDockerImagesFromAgents(req.user!.username, agentIds));
}));

apiRouter.get('/docker-images/:id', authRequired, requirePasswordOk, (req, res) => {
  res.json(imagesService.getDockerImage(param(req)));
});
apiRouter.post('/docker-images', authRequired, requirePasswordOk, requireModify, validateBody(createDockerImageSchema), asyncHandler(async (req, res) => {
  res.status(201).json(await imagesService.createDockerImage(req.body, req.user!.username));
}));

apiRouter.put('/docker-images/:id', authRequired, requirePasswordOk, requireModify, validateBody(updateDockerImageSchema), asyncHandler(async (req, res) => {
  res.json(await imagesService.updateDockerImage(param(req), req.body, req.user!.username));
}));

apiRouter.delete('/docker-images/:id', authRequired, requirePasswordOk, requireModify, asyncHandler(async (req, res) => {
  res.json(await imagesService.deleteDockerImage(param(req), req.user!.username));
}));
