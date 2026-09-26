import { v4 as uuid } from 'uuid';
import { secretsRepo } from '../repositories/secretsRepo';
import { encryptSecret, decryptSecret } from './crypto';
import { audit } from './audit';
import { AppError } from '../utils/errors';

export function listSecrets() {
  return secretsRepo.listMeta();
}

export async function createSecret(
  input: { name: string; type: string; value: string | Record<string, unknown> },
  actor: string,
) {
  const id = uuid();
  const now = new Date();
  const plain = typeof input.value === 'string' ? input.value : JSON.stringify(input.value);
  secretsRepo.insert({
    id,
    name: input.name,
    type: input.type,
    ciphertext: encryptSecret(plain),
    createdAt: now,
    updatedAt: now,
  });
  await audit({ actor, action: 'secret.created', entity: 'secret', entityId: id });
  return { id, name: input.name, type: input.type };
}

export async function updateSecret(
  id: string,
  input: { name?: string; value?: string | Record<string, unknown> },
  actor: string,
) {
  const existing = secretsRepo.findById(id);
  if (!existing) throw new AppError(404, 'not found', 'not_found');

  const patch: { name?: string; ciphertext?: string; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (input.name != null) {
    const name = String(input.name).trim();
    if (!name) throw new AppError(400, 'name required', 'invalid_name');
    patch.name = name;
  }
  if (input.value !== undefined) {
    const plain = typeof input.value === 'string' ? input.value : JSON.stringify(input.value);
    if (!plain || (typeof input.value === 'string' && !plain.trim())) {
      throw new AppError(400, 'value required', 'invalid_value');
    }
    patch.ciphertext = encryptSecret(plain);
  }
  if (patch.name == null && patch.ciphertext == null) {
    throw new AppError(400, 'nothing to update', 'empty_patch');
  }

  secretsRepo.update(id, patch);
  await audit({
    actor,
    action: 'secret.updated',
    entity: 'secret',
    entityId: id,
    payload: { nameChanged: patch.name != null, valueRotated: patch.ciphertext != null },
  });
  const row = secretsRepo.findById(id)!;
  return { id: row.id, name: row.name, type: row.type };
}

export async function deleteSecret(id: string, actor: string) {
  const existing = secretsRepo.findById(id);
  if (!existing) throw new AppError(404, 'not found', 'not_found');
  secretsRepo.delete(id);
  await audit({ actor, action: 'secret.deleted', entity: 'secret', entityId: id });
}

export function getSecretPlain(id: string): string | null {
  const row = secretsRepo.findById(id);
  if (!row) return null;
  return decryptSecret(row.ciphertext);
}

/** String secrets usable as Compose env (name = key). Agent env overrides these. */
export function getGlobalComposeEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of secretsRepo.list()) {
    if (row.type === 'registry_credentials') continue;
    try {
      const plain = decryptSecret(row.ciphertext);
      // JSON objects (registry) skipped; plain string tokens only
      if (plain.trim().startsWith('{')) continue;
      out[row.name] = plain;
    } catch {
      /* skip broken */
    }
  }
  return out;
}
