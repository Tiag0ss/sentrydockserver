import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Exercises the same open rules as server/database/db.ts without importing
 * the live process DB (which opens on module load).
 */
describe('sqlite encryption open rules', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function tmpDb(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-sqlite-'));
    dirs.push(dir);
    return path.join(dir, 'test.sqlite');
  }

  function derive(pass: string) {
    return crypto.createHash('sha256').update(pass, 'utf8').digest();
  }

  it('encrypts plaintext in place with rekey and requires key afterwards', async () => {
    const Database = (await import('better-sqlite3-multiple-ciphers')).default;
    const file = tmpDb();
    const plain = new Database(file);
    plain.exec('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1)');
    plain.close();
    expect(fs.readFileSync(file).subarray(0, 15).toString()).toBe('SQLite format 3');

    const enc = new Database(file);
    enc.rekey(derive('test-pass'));
    expect(enc.prepare('SELECT x FROM t').get()).toEqual({ x: 1 });
    enc.close();
    expect(fs.readFileSync(file).subarray(0, 15).toString()).not.toBe('SQLite format 3');

    const reopen = new Database(file);
    reopen.key(derive('test-pass'));
    expect(reopen.prepare('SELECT x FROM t').get()).toEqual({ x: 1 });
    reopen.close();
  });

  it('fails to read encrypted file without key', async () => {
    const Database = (await import('better-sqlite3-multiple-ciphers')).default;
    const file = tmpDb();
    const db = new Database(file);
    db.rekey(derive('secret'));
    db.exec('CREATE TABLE t (x)');
    db.close();

    const bad = new Database(file);
    expect(() => bad.prepare('SELECT 1').get()).toThrow();
    bad.close();
  });
});
