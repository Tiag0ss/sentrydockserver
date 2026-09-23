import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { usersRepo } from '../repositories/usersRepo';
import { templatesRepo, settingsRepo } from '../repositories/domainRepo';

const BUILTIN_TEMPLATES = [
  { key: 'update_available', name: 'Actualização disponível', body: JSON.stringify({ text: 'Update available for {{containerName}} on {{agentName}}: {{image}} ({{oldDigest}} → {{newDigest}})' }) },
  { key: 'execution_failed', name: 'Falha de execução', body: JSON.stringify({ text: 'Flow {{flowName}} run {{runId}} failed at {{nodeName}}: {{error}}' }) },
  { key: 'update_success', name: 'Actualizado com sucesso', body: JSON.stringify({ text: 'Successfully updated {{containerName}} on {{agentName}} to {{newDigest}}' }) },
  { key: 'flow_started', name: 'Flow iniciado', body: JSON.stringify({ text: 'Flow {{flowName}} started (run {{runId}})' }) },
  { key: 'flow_interrupted', name: 'Flow interrompido', body: JSON.stringify({ text: 'Flow {{flowName}} interrupted at {{nodeName}}, resuming…' }) },
  { key: 'awaiting_approval', name: 'Aguarda aprovação', body: JSON.stringify({ text: 'Update for {{containerName}} awaits approval' }) },
];

export async function seedDatabase() {
  const now = new Date();
  for (const t of BUILTIN_TEMPLATES) {
    if (!templatesRepo.findByKey(t.key)) {
      templatesRepo.insert({
        id: uuid(),
        key: t.key,
        name: t.name,
        body: t.body,
        builtin: true,
        createdAt: now,
      });
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
