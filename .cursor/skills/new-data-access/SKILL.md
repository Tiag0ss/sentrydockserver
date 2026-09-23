---
name: new-data-access
description: >-
  Add or change persistence via JSON table schemas (DDL) and Drizzle repositories
  (queries). Use when adding tables/columns or repository methods. SQLite only.
---

# New data access

1. **Schema (DDL):** edit `server/database/structure/systemtables/{table}.json` — never add SQL migration files.
2. **Typed layer:** mirror fields in `server/database/schema.ts` (Drizzle).
3. Put queries in `server/repositories/` — not in HTTP/UI files.
4. Restart (or ensure `buildAllTables()` runs) so SQLite picks up new tables/columns.
5. Parameterize all user-derived values.
6. Do not log full row payloads that may contain PII/secrets.

Related: skill `db-schema-json`, rule `database-json-schema.mdc`.
