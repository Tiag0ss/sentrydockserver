import { eq } from 'drizzle-orm';
import { db } from '../database/db';
import { dockerImages } from '../database/schema';

export const imagesRepo = {
  list() {
    return db.select().from(dockerImages).all();
  },
  findById(id: string) {
    return db.select().from(dockerImages).where(eq(dockerImages.id, id)).get();
  },
  findByKey(key: string) {
    return db.select().from(dockerImages).where(eq(dockerImages.key, key)).get();
  },
  insert(row: typeof dockerImages.$inferInsert) {
    db.insert(dockerImages).values(row).run();
  },
  update(id: string, patch: Partial<typeof dockerImages.$inferInsert>) {
    db.update(dockerImages).set(patch).where(eq(dockerImages.id, id)).run();
  },
  delete(id: string) {
    db.delete(dockerImages).where(eq(dockerImages.id, id)).run();
  },
};
