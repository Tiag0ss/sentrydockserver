import { v4 as uuid } from 'uuid';
import { secretsRepo } from '../repositories/secretsRepo';
import { encryptSecret, decryptSecret } from './crypto';
import { audit } from './audit';

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

export async function deleteSecret(id: string, actor: string) {
  secretsRepo.delete(id);
  await audit({ actor, action: 'secret.deleted', entity: 'secret', entityId: id });
}

export function getSecretPlain(id: string): string | null {
  const row = secretsRepo.findById(id);
  if (!row) return null;
  return decryptSecret(row.ciphertext);
}
