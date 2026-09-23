import { eq } from 'drizzle-orm';
import { db } from '../database/db';
import { flows } from '../database/schema';

export const flowsRepo = {
  list() {
    return db.select().from(flows).all();
  },
  findById(id: string) {
    return db.select().from(flows).where(eq(flows.id, id)).get();
  },
  insert(row: {
    id: string;
    name: string;
    description: string | null;
    graphJson: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    db.insert(flows).values(row).run();
  },
  update(id: string, patch: {
    name: string;
    description: string | null;
    graphJson: string;
    updatedAt: Date;
  }) {
    db.update(flows).set(patch).where(eq(flows.id, id)).run();
  },
  delete(id: string) {
    db.delete(flows).where(eq(flows.id, id)).run();
  },
};
