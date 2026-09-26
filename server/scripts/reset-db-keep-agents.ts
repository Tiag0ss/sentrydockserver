/**
 * Manual DB reset: drop all tables, rebuild schema from systemtables JSON,
 * re-seed defaults, and restore the `agents` rows so installed tokens keep working.
 *
 * Usage (from server/):
 *   pnpm reset-db-keep-agents
 *
 * Never runs on boot — invoke explicitly after schema changes that remove columns
 * (schemaBuilder only adds columns).
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function main() {
  const { sqlite } = await import('../database/db');
  const { buildAllTables } = await import('../utils/schemaBuilder');
  const { seedDatabase } = await import('../services/seed');

  let agentsBackup: Record<string, unknown>[] = [];
  try {
    const exists = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agents'`)
      .get() as { name?: string } | undefined;
    if (exists?.name) {
      agentsBackup = sqlite.prepare('SELECT * FROM agents').all() as Record<string, unknown>[];
    }
  } catch (err) {
    console.warn('Could not read agents table (continuing with empty backup):', err);
  }

  console.log(`Preserving ${agentsBackup.length} agent row(s).`);

  const tables = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>;

  sqlite.exec('PRAGMA foreign_keys = OFF');
  for (const { name } of tables) {
    sqlite.exec(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`);
    console.log(`Dropped ${name}`);
  }
  sqlite.exec('PRAGMA foreign_keys = ON');

  buildAllTables();
  await seedDatabase();

  if (agentsBackup.length) {
    const cols = (
      sqlite.prepare(`PRAGMA table_info(agents)`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    const insertCols = cols.filter((c) => c !== undefined);
    const placeholders = insertCols.map(() => '?').join(', ');
    const colList = insertCols.map((c) => `"${c}"`).join(', ');
    const stmt = sqlite.prepare(
      `INSERT OR REPLACE INTO agents (${colList}) VALUES (${placeholders})`,
    );

    const restore = sqlite.transaction((rows: Record<string, unknown>[]) => {
      for (const row of rows) {
        const values = insertCols.map((c) => row[c] ?? null);
        stmt.run(...values);
      }
    });
    restore(agentsBackup);
    console.log(`Restored ${agentsBackup.length} agent row(s).`);
  }

  console.log('Done. Schema rebuilt; users/templates/settings reseeded; agents preserved.');
  console.log('Default login if users were wiped: admin / admin');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
