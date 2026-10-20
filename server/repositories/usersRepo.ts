import { eq, and, ne } from 'drizzle-orm';
import { db } from '../database/db';
import { users } from '../database/schema';

export const usersRepo = {
  findById(id: string) {
    return db.select().from(users).where(eq(users.id, id)).get();
  },
  findByUsername(username: string) {
    return db.select().from(users).where(eq(users.username, username)).get();
  },
  listPublic() {
    return db.select({
      id: users.id,
      username: users.username,
      role: users.role,
      mustChangePassword: users.mustChangePassword,
      createdAt: users.createdAt,
    }).from(users).all();
  },
  insert(row: {
    id: string;
    username: string;
    passwordHash: string;
    role: string;
    mustChangePassword?: boolean;
    createdAt: Date;
  }) {
    db.insert(users).values({
      ...row,
      mustChangePassword: row.mustChangePassword ?? false,
    }).run();
  },
  update(id: string, patch: Partial<{
    passwordHash: string;
    role: string;
    mustChangePassword: boolean;
    lastSeenAppVersion: string | null;
  }>) {
    db.update(users).set(patch).where(eq(users.id, id)).run();
  },
  getLastSeenAppVersion(id: string): string | null {
    const row = db.select({
      lastSeenAppVersion: users.lastSeenAppVersion,
    }).from(users).where(eq(users.id, id)).get();
    return row?.lastSeenAppVersion ?? null;
  },
  setLastSeenAppVersion(id: string, version: string) {
    db.update(users).set({ lastSeenAppVersion: version }).where(eq(users.id, id)).run();
  },
  delete(id: string) {
    db.delete(users).where(eq(users.id, id)).run();
  },
  count() {
    return db.select().from(users).all().length;
  },
  countModifyExcept(exceptId: string) {
    return db.select().from(users).where(
      and(eq(users.role, 'modify'), ne(users.id, exceptId)),
    ).all().length;
  },
};
