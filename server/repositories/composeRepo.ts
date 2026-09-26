import { and, eq } from 'drizzle-orm';
import { db } from '../database/db';
import { composeAgentStates, composeProjects } from '../database/schema';

export const composeProjectsRepo = {
  list() {
    return db.select().from(composeProjects).all();
  },
  findById(id: string) {
    return db.select().from(composeProjects).where(eq(composeProjects.id, id)).get();
  },
  findByName(name: string) {
    return db.select().from(composeProjects).where(eq(composeProjects.name, name)).get();
  },
  insert(row: typeof composeProjects.$inferInsert) {
    db.insert(composeProjects).values(row).run();
  },
  update(id: string, patch: Partial<typeof composeProjects.$inferInsert>) {
    db.update(composeProjects).set(patch).where(eq(composeProjects.id, id)).run();
  },
  delete(id: string) {
    db.delete(composeProjects).where(eq(composeProjects.id, id)).run();
  },
};

export const composeStatesRepo = {
  listByProject(composeProjectId: string) {
    return db.select().from(composeAgentStates)
      .where(eq(composeAgentStates.composeProjectId, composeProjectId)).all();
  },
  find(composeProjectId: string, agentId: string) {
    return db.select().from(composeAgentStates).where(and(
      eq(composeAgentStates.composeProjectId, composeProjectId),
      eq(composeAgentStates.agentId, agentId),
    )).get();
  },
  findById(id: string) {
    return db.select().from(composeAgentStates).where(eq(composeAgentStates.id, id)).get();
  },
  insert(row: typeof composeAgentStates.$inferInsert) {
    db.insert(composeAgentStates).values(row).run();
  },
  update(id: string, patch: Partial<typeof composeAgentStates.$inferInsert>) {
    db.update(composeAgentStates).set(patch).where(eq(composeAgentStates.id, id)).run();
  },
  deleteByProject(composeProjectId: string) {
    db.delete(composeAgentStates).where(eq(composeAgentStates.composeProjectId, composeProjectId)).run();
  },
};
