CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'modify',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL,
      transport TEXT NOT NULL DEFAULT 'ws',
      protocol_version INTEGER,
      agent_version TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      hostname TEXT,
      last_seen_at INTEGER,
      meta_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS secrets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      graph_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS container_watches (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      container_name TEXT NOT NULL,
      image TEXT NOT NULL,
      secret_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS update_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      watch_id TEXT NOT NULL,
      flow_id TEXT NOT NULL,
      cron TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Europe/Lisbon',
      mode TEXT NOT NULL DEFAULT 'notify',
      enabled INTEGER NOT NULL DEFAULT 1,
      blackout_start TEXT,
      blackout_end TEXT,
      next_run_at INTEGER,
      last_run_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS flow_runs (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger_source TEXT NOT NULL,
      lock_key TEXT,
      current_node_id TEXT,
      context_json TEXT,
      dry_run INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS flow_run_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      branch_id TEXT,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      started_at INTEGER,
      finished_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS flow_run_branches (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      split_node_id TEXT NOT NULL,
      agent_id TEXT,
      container_name TEXT,
      status TEXT NOT NULL,
      context_json TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      flow_run_id TEXT,
      payload_json TEXT
    );
    CREATE TABLE IF NOT EXISTS message_templates (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      builtin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webhook_triggers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      flow_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      agent_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS update_events (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      watch_id TEXT NOT NULL,
      status TEXT NOT NULL,
      old_digest TEXT,
      new_digest TEXT,
      image TEXT,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_flow_runs_status ON flow_runs(status);
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts);
    CREATE INDEX IF NOT EXISTS idx_policies_next ON update_policies(next_run_at);
