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

export const createFlowSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  graph: z.unknown().optional(),
});

export const updateFlowSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  graph: z.unknown().optional(),
});

export const runFlowSchema = z.object({
  context: z.record(z.unknown()).optional(),
  dryRun: z.boolean().optional(),
});

export const continueRunSchema = z.object({
  continue: z.boolean(),
  branchIds: z.array(z.string()).optional(),
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

export const createTemplateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  body: z.string().min(1),
});

export const createWebhookTriggerSchema = z.object({
  name: z.string().optional(),
  flowId: z.string().min(1),
  agentId: z.string().nullable().optional(),
});

export const updateSettingSchema = z.object({
  value: z.string(),
});
