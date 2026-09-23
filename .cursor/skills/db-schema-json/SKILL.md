---
name: db-schema-json
description: >-
  Apply database field/table changes via JSON schema files under
  server/database/structure/systemtables/. Use when adding or modifying tables
  or columns — never hand-written SQL migration files. SQLite only.
---

# Skill: Database Schema via JSON Structure

## Goal

Apply database field/table changes using JSON schema files under `server/database/structure/systemtables/`.

## Placement

- Schema source of truth: `server/database/structure/systemtables/*.json` only.
- Typed queries: keep `server/database/schema.ts` (Drizzle) aligned with JSON.
- Sync on startup: `buildAllTables()` in `server/utils/schemaBuilder.ts`.

## Execution rules

1. Never create SQL migration scripts for schema updates.
2. Update only the JSON structure files (+ Drizzle mirror when querying).
3. For new tables, use top-level `PrimaryKeyFields` (string).
4. For string `DefaultValue`, do not add extra quotes inside the string value.
5. Prefer portable types (`text`, `varchar(N)`, `integer`, `tinyint(1)`); builder maps to SQLite.
6. Restart server (or call `buildAllTables`) to sync.

## Output

- Implement JSON and required code updates directly.
- Summarize updated schema file(s) and dependent code.
