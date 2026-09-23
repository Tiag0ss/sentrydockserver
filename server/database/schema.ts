import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('modify'), // modify | monitor
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  tokenHash: text('token_hash').notNull(),
  transport: text('transport').notNull().default('ws'),
  protocolVersion: integer('protocol_version'),
  agentVersion: text('agent_version'),
  status: text('status').notNull().default('offline'), // online | offline | incompatible
  hostname: text('hostname'),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }),
  metaJson: text('meta_json'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const secrets = sqliteTable('secrets', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  type: text('type').notNull(), // registry_credentials | generic_token | header_secret
  ciphertext: text('ciphertext').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const flows = sqliteTable('flows', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  graphJson: text('graph_json').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const containerWatches = sqliteTable('container_watches', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  containerName: text('container_name').notNull(),
  image: text('image').notNull(),
  secretId: text('secret_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const updatePolicies = sqliteTable('update_policies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  watchId: text('watch_id').notNull(),
  flowId: text('flow_id').notNull(),
  cron: text('cron').notNull(),
  timezone: text('timezone').notNull().default('Europe/Lisbon'),
  mode: text('mode').notNull().default('notify'), // auto | notify
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  blackoutStart: text('blackout_start'), // HH:mm
  blackoutEnd: text('blackout_end'),
  nextRunAt: integer('next_run_at', { mode: 'timestamp_ms' }),
  lastRunAt: integer('last_run_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const flowRuns = sqliteTable('flow_runs', {
  id: text('id').primaryKey(),
  flowId: text('flow_id').notNull(),
  status: text('status').notNull(),
  triggerSource: text('trigger_source').notNull(), // cron | manual | webhook | resume
  lockKey: text('lock_key'),
  currentNodeId: text('current_node_id'),
  contextJson: text('context_json'),
  dryRun: integer('dry_run', { mode: 'boolean' }).notNull().default(false),
  summary: text('summary'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
});

export const flowRunSteps = sqliteTable('flow_run_steps', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  nodeId: text('node_id').notNull(),
  branchId: text('branch_id'),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
});

export const flowRunBranches = sqliteTable('flow_run_branches', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  splitNodeId: text('split_node_id').notNull(),
  agentId: text('agent_id'),
  containerName: text('container_name'),
  status: text('status').notNull(),
  contextJson: text('context_json'),
});

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  ts: integer('ts', { mode: 'timestamp_ms' }).notNull(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  entity: text('entity'),
  entityId: text('entity_id'),
  flowRunId: text('flow_run_id'),
  payloadJson: text('payload_json'),
});

export const messageTemplates = sqliteTable('message_templates', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  body: text('body').notNull(),
  builtin: integer('builtin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const webhookTriggers = sqliteTable('webhook_triggers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  flowId: text('flow_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  agentId: text('agent_id'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const updateEvents = sqliteTable('update_events', {
  id: text('id').primaryKey(),
  policyId: text('policy_id').notNull(),
  watchId: text('watch_id').notNull(),
  status: text('status').notNull(), // pending | approved | dismissed | executed
  oldDigest: text('old_digest'),
  newDigest: text('new_digest'),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
