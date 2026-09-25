import { eq } from 'drizzle-orm';
import { db } from '../database/db';
import { flows } from '../database/schema';

export type FlowSchedulePatch = {
  name?: string;
  description?: string | null;
  graphJson?: string;
  scheduleEnabled?: boolean;
  cron?: string | null;
  timezone?: string | null;
  blackoutStart?: string | null;
  blackoutEnd?: string | null;
  nextRunAt?: Date | null;
  lastRunAt?: Date | null;
  updatedAt?: Date;
};

export const flowsRepo = {
  list() {
    return db.select().from(flows).all();
  },
  listScheduled() {
    return db.select().from(flows).where(eq(flows.scheduleEnabled, true)).all();
  },
  findById(id: string) {
    return db.select().from(flows).where(eq(flows.id, id)).get();
  },
  insert(row: {
    id: string;
    name: string;
    description: string | null;
    graphJson: string;
    scheduleEnabled?: boolean;
    cron?: string | null;
    timezone?: string | null;
    blackoutStart?: string | null;
    blackoutEnd?: string | null;
    nextRunAt?: Date | null;
    lastRunAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    db.insert(flows).values({
      scheduleEnabled: false,
      timezone: 'Europe/Lisbon',
      ...row,
    }).run();
  },
  update(id: string, patch: FlowSchedulePatch) {
    db.update(flows).set(patch).where(eq(flows.id, id)).run();
  },
  delete(id: string) {
    db.delete(flows).where(eq(flows.id, id)).run();
  },
};
