import { z } from 'zod';

/** HH:mm ou vazio/null (intervalo de blackout). */
export const blackoutTimeSchema = z
  .union([
    z.null(),
    z.literal(''),
    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:mm'),
  ])
  .optional()
  .transform((v) => (v == null || v === '' ? null : v));

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
  blackoutStart: blackoutTimeSchema,
  blackoutEnd: blackoutTimeSchema,
});

export const createUpdateFlowFromImageSchema = z.object({
  targets: z.array(z.object({
    agentId: z.string().min(1),
    containerName: z.string().min(1),
  })).min(1).optional(),
});

export const updateFlowSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  graph: z.unknown().optional(),
  scheduleEnabled: z.boolean().optional(),
  cron: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  blackoutStart: blackoutTimeSchema,
  blackoutEnd: blackoutTimeSchema,
});

export const runFlowSchema = z.object({
  context: z.record(z.unknown()).optional(),
  dryRun: z.boolean().optional(),
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
  blackoutStart: blackoutTimeSchema,
  blackoutEnd: blackoutTimeSchema,
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
  blackoutStart: blackoutTimeSchema,
  blackoutEnd: blackoutTimeSchema,
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
  env: z.record(z.string()).optional(),
  envUpsert: z.record(z.string()).optional(),
  envDelete: z.array(z.string()).optional(),
});

export const continueRunSchema = z.object({
  continue: z.boolean(),
  branchIds: z.array(z.string()).optional(),
  targetTag: z.string().optional(),
  targetRange: z.string().optional(),
  targetMode: z.string().optional(),
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

export const createComposeProjectSchema = z.object({
  name: z.string().min(1),
  yamlText: z.string().min(1),
});

export const updateComposeProjectSchema = z.object({
  name: z.string().min(1).optional(),
  yamlText: z.string().min(1).optional(),
});

export const deployComposeSchema = z.object({
  agentIds: z.array(z.string()).min(1),
  force: z.boolean().optional(),
});

export const checkComposeSchema = z.object({
  agentIds: z.array(z.string()).optional(),
});

export const createDockerImageSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  repository: z.string().min(1),
  targetMode: z.enum(['follow_tag', 'pin_tag', 'semver_range']).optional(),
  targetTag: z.string().nullable().optional(),
  targetRange: z.string().nullable().optional(),
  allowPrerelease: z.boolean().optional(),
  secretId: z.string().nullable().optional(),
});

export const updateDockerImageSchema = z.object({
  key: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  repository: z.string().min(1).optional(),
  targetMode: z.enum(['follow_tag', 'pin_tag', 'semver_range']).optional(),
  targetTag: z.string().nullable().optional(),
  targetRange: z.string().nullable().optional(),
  allowPrerelease: z.boolean().optional(),
  secretId: z.string().nullable().optional(),
});
