import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { usersRepo } from '../repositories/usersRepo';
import { signToken, type AuthUser } from '../middleware/auth';
import { audit } from './audit';
import { AppError } from '../utils/errors';

const DEFAULT_USER = 'admin';
const DEFAULT_PASSWORD = 'admin';

function toAuthUser(row: { id: string; username: string; role: string; mustChangePassword: boolean }): AuthUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role as AuthUser['role'],
    mustChangePassword: Boolean(row.mustChangePassword),
  };
}

export async function login(username: string, password: string) {
  const row = usersRepo.findByUsername(username);
  if (!row || !(await bcrypt.compare(password, row.passwordHash))) {
    throw new AppError(401, 'invalid credentials', 'unauthorized');
  }

  let mustChange = Boolean(row.mustChangePassword);
  // Default credentials always force a password change
  if (username === DEFAULT_USER && password === DEFAULT_PASSWORD) {
    mustChange = true;
    if (!row.mustChangePassword) {
      usersRepo.update(row.id, { mustChangePassword: true });
    }
  }

  const user = toAuthUser({ ...row, mustChangePassword: mustChange });
  return { token: signToken(user), user };
}

export function getMe(userId: string) {
  const row = usersRepo.findById(userId);
  if (!row) throw new AppError(401, 'unauthorized', 'unauthorized');
  return { user: toAuthUser(row) };
}

export function listUsers() {
  return usersRepo.listPublic().map((u) => ({
    ...u,
    mustChangePassword: Boolean(u.mustChangePassword),
  }));
}

export async function createUser(
  input: { username: string; password: string; role?: string; mustChangePassword?: boolean },
  actor: string,
) {
  if (usersRepo.findByUsername(input.username)) {
    throw new AppError(409, 'username already exists', 'conflict');
  }
  if (input.password.length < 6) {
    throw new AppError(400, 'password too short', 'validation_error');
  }
  const id = uuid();
  const role = input.role === 'monitor' ? 'monitor' : 'modify';
  usersRepo.insert({
    id,
    username: input.username.trim(),
    passwordHash: await bcrypt.hash(input.password, 10),
    role,
    mustChangePassword: Boolean(input.mustChangePassword),
    createdAt: new Date(),
  });
  await audit({ actor, action: 'user.created', entity: 'user', entityId: id });
  return { id, username: input.username.trim(), role, mustChangePassword: Boolean(input.mustChangePassword) };
}

export async function updateUser(
  id: string,
  input: { role?: string; password?: string; mustChangePassword?: boolean },
  actor: AuthUser,
) {
  const existing = usersRepo.findById(id);
  if (!existing) throw new AppError(404, 'not found', 'not_found');

  const patch: Partial<{ passwordHash: string; role: string; mustChangePassword: boolean }> = {};

  if (input.role != null) {
    const role = input.role === 'monitor' ? 'monitor' : 'modify';
    if (existing.role === 'modify' && role === 'monitor') {
      if (usersRepo.countModifyExcept(id) === 0) {
        throw new AppError(400, 'cannot demote the last modify user', 'last_admin');
      }
    }
    patch.role = role;
  }

  if (input.password != null && input.password !== '') {
    if (input.password.length < 6) {
      throw new AppError(400, 'password too short', 'validation_error');
    }
    patch.passwordHash = await bcrypt.hash(input.password, 10);
    patch.mustChangePassword = input.mustChangePassword ?? true;
  } else if (input.mustChangePassword != null) {
    patch.mustChangePassword = input.mustChangePassword;
  }

  if (Object.keys(patch).length === 0) {
    throw new AppError(400, 'no changes', 'validation_error');
  }

  usersRepo.update(id, patch);
  await audit({ actor: actor.username, action: 'user.updated', entity: 'user', entityId: id });
  const updated = usersRepo.findById(id)!;
  return {
    id: updated.id,
    username: updated.username,
    role: updated.role,
    mustChangePassword: Boolean(updated.mustChangePassword),
  };
}

export async function deleteUser(id: string, actor: AuthUser) {
  const existing = usersRepo.findById(id);
  if (!existing) throw new AppError(404, 'not found', 'not_found');
  if (existing.id === actor.id) {
    throw new AppError(400, 'cannot delete yourself', 'cannot_delete_self');
  }
  if (existing.role === 'modify' && usersRepo.countModifyExcept(id) === 0) {
    throw new AppError(400, 'cannot delete the last modify user', 'last_admin');
  }
  usersRepo.delete(id);
  await audit({ actor: actor.username, action: 'user.deleted', entity: 'user', entityId: id });
  return { ok: true };
}

export async function changeOwnPassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
) {
  const row = usersRepo.findById(userId);
  if (!row) throw new AppError(401, 'unauthorized', 'unauthorized');
  if (!(await bcrypt.compare(input.currentPassword, row.passwordHash))) {
    throw new AppError(400, 'current password is incorrect', 'bad_password');
  }
  if (input.newPassword.length < 6) {
    throw new AppError(400, 'password too short', 'validation_error');
  }
  if (input.newPassword === DEFAULT_PASSWORD && row.username === DEFAULT_USER) {
    throw new AppError(400, 'choose a password other than the default', 'default_password');
  }
  if (input.newPassword === input.currentPassword) {
    throw new AppError(400, 'new password must be different', 'same_password');
  }
  usersRepo.update(userId, {
    passwordHash: await bcrypt.hash(input.newPassword, 10),
    mustChangePassword: false,
  });
  await audit({ actor: row.username, action: 'user.password_changed', entity: 'user', entityId: userId });
  const updated = usersRepo.findById(userId)!;
  const user = toAuthUser(updated);
  return { token: signToken(user), user };
}

export { DEFAULT_USER, DEFAULT_PASSWORD };
