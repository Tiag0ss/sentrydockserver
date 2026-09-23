import { eq } from 'drizzle-orm';
import { db } from '../database/db';
import { agents } from '../database/schema';

export const agentsRepo = {
  list() {
    return db.select({
      id: agents.id,
      name: agents.name,
      transport: agents.transport,
      protocolVersion: agents.protocolVersion,
      agentVersion: agents.agentVersion,
      status: agents.status,
      hostname: agents.hostname,
      lastSeenAt: agents.lastSeenAt,
      metaJson: agents.metaJson,
      createdAt: agents.createdAt,
    }).from(agents).all();
  },
  findById(id: string) {
    return db.select().from(agents).where(eq(agents.id, id)).get();
  },
  findByName(name: string) {
    return db.select().from(agents).where(eq(agents.name, name)).get();
  },
  findByTokenHash(tokenHash: string) {
    return db.select().from(agents).where(eq(agents.tokenHash, tokenHash)).get();
  },
  insert(row: {
    id: string;
    name: string;
    tokenHash: string;
    transport: string;
    status: string;
    createdAt: Date;
  }) {
    db.insert(agents).values(row).run();
  },
  delete(id: string) {
    db.delete(agents).where(eq(agents.id, id)).run();
  },
  update(id: string, patch: Partial<{
    status: string;
    protocolVersion: number | null;
    agentVersion: string | null;
    hostname: string | null;
    transport: string;
    lastSeenAt: Date | null;
    metaJson: string | null;
  }>) {
    db.update(agents).set(patch).where(eq(agents.id, id)).run();
  },
};
