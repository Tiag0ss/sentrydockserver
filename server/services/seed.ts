import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { usersRepo } from '../repositories/usersRepo';
import { templatesRepo, settingsRepo } from '../repositories/domainRepo';

/** Slack / generic: `text` field. Discord: `content` field. Names in EN. */
const BUILTIN_TEMPLATES = [
  {
    key: 'update_available',
    name: 'Update available (Slack / generic)',
    body: JSON.stringify({
      text: 'Update available for {{containerName}} on {{agentName}}: {{image}} ({{oldDigest}} → {{newDigest}})',
    }),
  },
  {
    key: 'execution_failed',
    name: 'Execution failed (Slack / generic)',
    body: JSON.stringify({
      text: 'Flow {{flowName}} run {{runId}} failed at {{nodeName}}: {{error}}',
    }),
  },
  {
    key: 'update_success',
    name: 'Update success (Slack / generic)',
    body: JSON.stringify({
      text: 'Successfully updated {{containerName}} on {{agentName}} to {{newDigest}}',
    }),
  },
  {
    key: 'flow_started',
    name: 'Flow started (Slack / generic)',
    body: JSON.stringify({
      text: 'Flow {{flowName}} started (run {{runId}})',
    }),
  },
  {
    key: 'flow_interrupted',
    name: 'Flow interrupted (Slack / generic)',
    body: JSON.stringify({
      text: 'Flow {{flowName}} interrupted at {{nodeName}}, resuming…',
    }),
  },
  {
    key: 'awaiting_approval',
    name: 'Awaiting approval (Slack / generic)',
    body: JSON.stringify({
      text: 'Update for {{targetsCount}} container(s): {{targetsList}} awaits approval. Already up to date (skipped): {{skippedTargetsList}}',
    }),
  },
  {
    key: 'discord_update_available',
    name: 'Discord: Update available',
    body: JSON.stringify({
      content: 'Update available for {{containerName}} on {{agentName}}: {{image}} ({{oldDigest}} → {{newDigest}})',
    }),
  },
  {
    key: 'discord_execution_failed',
    name: 'Discord: Execution failed',
    body: JSON.stringify({
      content: 'Flow {{flowName}} run {{runId}} failed at {{nodeName}}: {{error}}',
    }),
  },
  {
    key: 'discord_update_success',
    name: 'Discord: Update success',
    body: JSON.stringify({
      content: 'Successfully updated {{containerName}} on {{agentName}} to {{newDigest}}',
    }),
  },
  {
    key: 'discord_flow_started',
    name: 'Discord: Flow started',
    body: JSON.stringify({
      content: 'Flow {{flowName}} started (run {{runId}})',
    }),
  },
  {
    key: 'discord_flow_interrupted',
    name: 'Discord: Flow interrupted',
    body: JSON.stringify({
      content: 'Flow {{flowName}} interrupted at {{nodeName}}, resuming…',
    }),
  },
  {
    key: 'discord_awaiting_approval',
    name: 'Discord: Awaiting approval',
    body: JSON.stringify({
      content: 'Update for {{targetsCount}} container(s): {{targetsList}} awaits approval. Already up to date (skipped): {{skippedTargetsList}}',
    }),
  },
];

/** Builtin keys whose name/body may be refreshed on boot. */
const REFRESH_BUILTIN_KEYS = new Set(BUILTIN_TEMPLATES.map((t) => t.key));

export async function seedDatabase() {
  const now = new Date();
  for (const t of BUILTIN_TEMPLATES) {
    const existing = templatesRepo.findByKey(t.key);
    if (!existing) {
      templatesRepo.insert({
        id: uuid(),
        key: t.key,
        name: t.name,
        body: t.body,
        builtin: true,
        createdAt: now,
      });
    } else if (existing.builtin && REFRESH_BUILTIN_KEYS.has(t.key)) {
      templatesRepo.update(existing.id, { body: t.body, name: t.name });
    }
  }

  if (!settingsRepo.get('log_retention_days')) {
    settingsRepo.upsert('log_retention_days', '90');
  }
  if (!settingsRepo.get('max_parallel_commands')) {
    settingsRepo.upsert('max_parallel_commands', String(process.env.MAX_PARALLEL_COMMANDS || 20));
  }

  if (usersRepo.count() === 0) {
    usersRepo.insert({
      id: uuid(),
      username: 'admin',
      passwordHash: await bcrypt.hash('admin', 10),
      role: 'modify',
      mustChangePassword: true,
      createdAt: now,
    });
  }
}
