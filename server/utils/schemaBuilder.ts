import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { sqlite } from '../database/db';
import logger from './logger';

interface Field {
  FieldName: string;
  DataType: string;
  NotNullable?: boolean;
  AutoIncrement?: boolean;
  Unique?: boolean;
  DefaultValue?: string | number | boolean | null;
  Comment?: string;
}

interface IndexDef {
  Name: string;
  Columns: string[];
  Unique?: boolean;
}

interface TableSchema {
  TableName: string;
  PrimaryKeyFields: string;
  Fields: Field[];
  Indexes?: IndexDef[];
}

function calculateMD5(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Map portable JSON types → SQLite affinity. */
function mapDataType(dataType: string): string {
  const normalized = dataType.trim().toLowerCase();

  if (normalized === 'boolean' || normalized === 'bool' || normalized === 'tinyint(1)') return 'INTEGER';
  if (normalized.startsWith('varchar(') || normalized.startsWith('nvarchar(')) return 'TEXT';
  if (normalized === 'text' || normalized === 'mediumtext' || normalized === 'longtext' || normalized === 'json') {
    return 'TEXT';
  }
  if (normalized === 'timestamp' || normalized === 'datetime' || normalized === 'date') return 'INTEGER';
  if (normalized === 'int' || normalized === 'integer' || normalized.startsWith('tinyint') || normalized.startsWith('bigint')) {
    return 'INTEGER';
  }
  if (normalized.startsWith('decimal') || normalized === 'double' || normalized === 'float' || normalized === 'real') {
    return 'REAL';
  }
  if (normalized === 'blob') return 'BLOB';
  // Already SQLite-ish
  if (normalized === 'text' || normalized === 'integer' || normalized === 'real' || normalized === 'blob') {
    return normalized.toUpperCase();
  }
  return 'TEXT';
}

function getDefaultSql(field: Field): string {
  if (field.DefaultValue === undefined || field.AutoIncrement) return '';
  if (field.DefaultValue === null) return ' DEFAULT NULL';
  if (field.DefaultValue === true || field.DefaultValue === false) {
    return ` DEFAULT ${field.DefaultValue ? 1 : 0}`;
  }
  if (typeof field.DefaultValue === 'number') {
    return ` DEFAULT ${field.DefaultValue}`;
  }
  const defaultValue = String(field.DefaultValue).trim();
  const upper = defaultValue.toUpperCase();
  if (upper === 'NULL' || upper === 'CURRENT_TIMESTAMP' || upper === 'CURRENT_DATE') {
    return ` DEFAULT ${defaultValue}`;
  }
  return ` DEFAULT '${defaultValue.replace(/'/g, "''")}'`;
}

function buildColumnDefinition(field: Field): string {
  const dataType = mapDataType(field.DataType);
  let columnSql = `${quoteIdentifier(field.FieldName)} ${dataType}`;
  if (field.AutoIncrement) columnSql += ' PRIMARY KEY AUTOINCREMENT';
  else columnSql += field.NotNullable ? ' NOT NULL' : '';
  columnSql += getDefaultSql(field);
  return columnSql;
}

function getPrimaryKeySql(schema: TableSchema): string | null {
  // Skip if a single AUTOINCREMENT field already declared PRIMARY KEY
  const autoPk = schema.Fields.find((f) => f.AutoIncrement);
  if (autoPk && schema.PrimaryKeyFields.trim() === autoPk.FieldName) {
    return null;
  }
  const primaryKeyFields = schema.PrimaryKeyFields
    .split(',')
    .map((field) => quoteIdentifier(field.trim()))
    .join(', ');
  return `PRIMARY KEY (${primaryKeyFields})`;
}

function getUniqueConstraintsSql(schema: TableSchema): string[] {
  return schema.Fields
    .filter((field) => field.Unique && !field.AutoIncrement)
    .map((field) => `UNIQUE (${quoteIdentifier(field.FieldName)})`);
}

function generateCreateTableSQL(schema: TableSchema): string {
  const fieldSqlList = schema.Fields.map((field) => buildColumnDefinition(field));
  const pk = getPrimaryKeySql(schema);
  if (pk) fieldSqlList.push(pk);
  fieldSqlList.push(...getUniqueConstraintsSql(schema));
  const body = fieldSqlList.join(',\n  ');
  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(schema.TableName)} (\n  ${body}\n)`;
}

function ensureSchemaVersionsTable(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL UNIQUE,
      schema_hash TEXT NOT NULL,
      last_updated INTEGER NOT NULL
    )
  `);
}

function getStoredSchemaHash(tableName: string): string | null {
  const row = sqlite
    .prepare('SELECT schema_hash AS schemaHash FROM schema_versions WHERE table_name = ?')
    .get(tableName) as { schemaHash: string } | undefined;
  return row?.schemaHash ?? null;
}

function updateSchemaHash(tableName: string, schemaHash: string): void {
  const now = Date.now();
  const result = sqlite
    .prepare('UPDATE schema_versions SET schema_hash = ?, last_updated = ? WHERE table_name = ?')
    .run(schemaHash, now, tableName);
  if (result.changes === 0) {
    sqlite
      .prepare('INSERT INTO schema_versions (table_name, schema_hash, last_updated) VALUES (?, ?, ?)')
      .run(tableName, schemaHash, now);
  }
}

function tableExists(tableName: string): boolean {
  const row = sqlite
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName) as { ok: number } | undefined;
  return Boolean(row);
}

function getExistingColumns(tableName: string): Set<string> {
  const rows = sqlite.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function addMissingColumns(tableName: string, schema: TableSchema): void {
  const existing = getExistingColumns(tableName);
  const toAdd = schema.Fields.filter((f) => !existing.has(f.FieldName));
  if (toAdd.length === 0) {
    logger.info(`  no new columns for ${tableName}`);
    return;
  }
  logger.info(`  adding ${toAdd.length} column(s) to ${tableName}`);
  for (const field of toAdd) {
    // SQLite: ADD COLUMN cannot use UNIQUE / PRIMARY KEY in many cases; keep definition simple
    const col = buildColumnDefinition({ ...field, Unique: false, AutoIncrement: false });
    try {
      sqlite.exec(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${col}`);
      logger.info(`    + ${field.FieldName}`);
    } catch (err) {
      logger.error(`    failed to add ${field.FieldName}`, {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function ensureIndexes(schema: TableSchema): void {
  if (!schema.Indexes?.length) return;
  for (const idx of schema.Indexes) {
    const cols = idx.Columns.map((c) => quoteIdentifier(c)).join(', ');
    const unique = idx.Unique ? 'UNIQUE ' : '';
    sqlite.exec(
      `CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdentifier(idx.Name)} ON ${quoteIdentifier(schema.TableName)} (${cols})`,
    );
  }
}

export function buildTableFromJSON(schemaPath: string): void {
  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
  const schema = JSON.parse(schemaContent) as TableSchema;
  const schemaHash = calculateMD5(schemaContent);

  if (!schema.TableName || !schema.PrimaryKeyFields || !Array.isArray(schema.Fields)) {
    throw new Error(`Invalid table schema in ${schemaPath}`);
  }

  const exists = tableExists(schema.TableName);
  if (exists) {
    const storedHash = getStoredSchemaHash(schema.TableName);
    if (storedHash === schemaHash) {
      ensureIndexes(schema);
      logger.info(`table up to date: ${schema.TableName}`);
      return;
    }
    logger.info(`schema changed: ${schema.TableName}`);
    addMissingColumns(schema.TableName, schema);
    ensureIndexes(schema);
    updateSchemaHash(schema.TableName, schemaHash);
    logger.info(`table updated: ${schema.TableName}`);
    return;
  }

  sqlite.exec(generateCreateTableSQL(schema));
  ensureIndexes(schema);
  updateSchemaHash(schema.TableName, schemaHash);
  logger.info(`table created: ${schema.TableName}`);
}

export function buildAllTables(structureDir?: string): void {
  const base = structureDir
    || path.join(process.cwd(), 'server', 'database', 'structure');
  ensureSchemaVersionsTable();

  const systemTablesPath = path.join(base, 'systemtables');
  if (!fs.existsSync(systemTablesPath)) {
    logger.warn('systemtables directory missing', { path: systemTablesPath });
    return;
  }

  const files = fs.readdirSync(systemTablesPath).filter((f) => f.endsWith('.json')).sort();
  for (const file of files) {
    buildTableFromJSON(path.join(systemTablesPath, file));
  }
  logger.info(`schema sync complete (${files.length} tables)`);
}
