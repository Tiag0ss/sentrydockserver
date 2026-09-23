import { eq } from 'drizzle-orm';
import { db } from '../database/db';
import { secrets } from '../database/schema';

export const secretsRepo = {
  listMeta() {
    return db.select({
      id: secrets.id,
      name: secrets.name,
      type: secrets.type,
      createdAt: secrets.createdAt,
      updatedAt: secrets.updatedAt,
    }).from(secrets).all();
  },
  findById(id: string) {
    return db.select().from(secrets).where(eq(secrets.id, id)).get();
  },
  insert(row: {
    id: string;
    name: string;
    type: string;
    ciphertext: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    db.insert(secrets).values(row).run();
  },
  delete(id: string) {
    db.delete(secrets).where(eq(secrets.id, id)).run();
  },
};
