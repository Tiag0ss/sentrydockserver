import Database from 'better-sqlite3-multiple-ciphers';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as schema from './schema';

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.SQLITE_PATH || path.join(dataDir, 'sentrydock.sqlite');

function truthy(v: string | undefined): boolean {
  if (!v) return false;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

/** Derive a 256-bit key from the passphrase (same approach as SECRETS_ENCRYPTION_KEY). */
function deriveSqliteKey(passphrase: string): Buffer {
  return crypto.createHash('sha256').update(passphrase, 'utf8').digest();
}

function looksLikePlainSqlite(filePath: string): boolean {
  try {
    const st = fs.statSync(filePath);
    if (st.size === 0) return true;
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return buf.toString('utf8').startsWith('SQLite format 3');
  } catch {
    return false;
  }
}

function openSqlite(filePath: string): InstanceType<typeof Database> {
  const encrypt = truthy(process.env.SQLITE_ENCRYPT);
  const passphrase = String(process.env.SQLITE_ENCRYPTION_KEY || '').trim();

  if (encrypt && !passphrase) {
    throw new Error(
      'SQLITE_ENCRYPT is enabled but SQLITE_ENCRYPTION_KEY is empty. Set a strong passphrase or disable SQLITE_ENCRYPT.',
    );
  }

  const exists = fs.existsSync(filePath);
  const sizeBefore = exists ? fs.statSync(filePath).size : 0;
  const wasPlain = sizeBefore > 0 && looksLikePlainSqlite(filePath);
  const wasEncrypted = sizeBefore > 0 && !looksLikePlainSqlite(filePath);

  if (wasEncrypted && !encrypt) {
    throw new Error(
      'SQLite file appears encrypted but SQLITE_ENCRYPT is off. Set SQLITE_ENCRYPT=true and SQLITE_ENCRYPTION_KEY to the passphrase used to encrypt it.',
    );
  }

  const sqlite = new Database(filePath);

  if (encrypt) {
    const key = deriveSqliteKey(passphrase);
    try {
      if (wasEncrypted) {
        sqlite.key(key);
      } else {
        // New DB or existing plaintext → encrypt at rest (idempotent for already-keyed new files).
        sqlite.rekey(key);
      }
      sqlite.prepare('SELECT count(*) AS c FROM sqlite_master').get();
    } catch (err) {
      sqlite.close();
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to open encrypted SQLite (${msg}). Check SQLITE_ENCRYPTION_KEY (wrong key or corrupt file).`,
      );
    }
  }

  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return sqlite;
}

const sqlite = openSqlite(dbPath);

export const db = drizzle(sqlite, { schema });
export { sqlite, dbPath };
