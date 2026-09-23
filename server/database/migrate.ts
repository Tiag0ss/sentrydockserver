import fs from 'fs';
import path from 'path';
import { sqlite } from './db';
import logger from '../utils/logger';

export function runMigrations() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const dir = path.join(process.cwd(), 'server', 'database', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    const applied = sqlite.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(id);
    if (applied) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const tx = sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(id, Date.now());
    });
    tx();
    logger.info(`Applied migration ${id}`);
  }
}
