import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const createUserSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(6).max(200),
  role: z.enum(['modify', 'monitor']).optional(),
  mustChangePassword: z.boolean().optional(),
});

export const updateUserSchema = z.object({
  role: z.enum(['modify', 'monitor']).optional(),
  password: z.string().min(6).max(200).optional(),
  mustChangePassword: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(200),
});

export const createAgentSchema = z.object({
  name: z.string().min(1),
  transport: z.enum(['ws', 'grpc']).optional(),
});

export const createSecretSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['registry_credentials', 'generic_token', 'header_secret']),
  value: z.union([z.string().min(1), z.record(z.unknown())]),
});

export const updateSecretSchema = z.object({
  name: z.string().min(1).optional(),
  value: z.union([z.string().min(1), z.record(z.unknown())]).optional(),
}).refine((v) => v.name != null || v.value != null, { message: 'name or value required' });

export const createFlowSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  graph: z.unknown().optional(),
  scheduleEnabled: z.boolean().optional(),
  cron: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  blackoutStart: z.string().nullable().optional(),
  blackoutEnd: z.string().nullable().optional(),
});

export const updateFlowSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  graph: z.unknown().optional(),
  scheduleEnabled: z.boolean().optional(),
  cron: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  blackoutStart: z.string().nullable().optional(),
  blackoutEnd: z.string().nullable().optional(),
});

export const runFlowSchema = z.object({
  context: z.record(z.unknown()).optional(),
  dryRun: z.boolean().optional(),
});

export const continueRunSchema = z.object({
  continue: z.boolean(),
  branchIds: z.array(z.string()).optional(),
});

export const rerunRunSchema = z.object({
  dryRun: z.boolean().optional(),
});

export const createWatchSchema = z.object({
  agentId: z.string().min(1),
  containerName: z.string().min(1),
  image: z.string().min(1),
  secretId: z.string().nullable().optional(),
});

export const createPolicySchema = z.object({
  name: z.string().optional(),
  watchId: z.string().min(1),
  flowId: z.string().min(1),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  mode: z.enum(['auto', 'notify']).optional(),
  blackoutStart: z.string().nullable().optional(),
  blackoutEnd: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export const updateWatchSchema = createWatchSchema.partial();

export const updatePolicySchema = z.object({
  name: z.string().optional(),
  watchId: z.string().min(1).optional(),
  flowId: z.string().min(1).optional(),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  mode: z.enum(['auto', 'notify']).optional(),
  blackoutStart: z.string().nullable().optional(),
  blackoutEnd: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export const createTemplateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  body: z.string().min(1),
});

export const updateTemplateSchema = z.object({
  key: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});

export const updateAgentSchema = z.object({
  labels: z.array(z.string()).optional(),
});

export const importBundleSchema = z.object({
  version: z.number().optional(),
  policies: z.array(z.unknown()).optional(),
  templates: z.array(z.object({
    key: z.string(),
    name: z.string(),
    body: z.string(),
  })).optional(),
  watches: z.array(z.unknown()).optional(),
});

export const createWebhookTriggerSchema = z.object({
  name: z.string().optional(),
  flowId: z.string().min(1),
  agentId: z.string().nullable().optional(),
});

export const updateWebhookTriggerSchema = z.object({
  name: z.string().min(1).optional(),
  flowId: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  agentId: z.string().nullable().optional(),
});

export const updateSettingSchema = z.object({
  value: z.string(),
});
