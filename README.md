# SentryDockServer

**SentryDockServer** is the control plane of SentryDock: the place where you manage Docker hosts, define how images and Compose stacks are updated, and watch every run from one UI.

It does **not** talk to Docker directly. Remote hosts run **SentryDockAgent**, which connects outbound to this server. You operate the fleet here; agents execute on the machines.

---

## What this project does

### One panel for many Docker hosts

Register agents, issue tokens, set labels and per-host environment variables. Online agents stream inventory (disk usage, dangling images, container counts) into the dashboard so you see fleet health without SSHing around.

### Image catalog and Compose as source of truth

Maintain a catalog of Docker images (follow a tag, pin a tag, or semver range). Reference them in Compose as `${SD_IMAGE_<key>}`. Store Compose YAML in the panel, deploy it to selected agents, and track per-host sync / drift. Global secrets and agent env fill `${VAR}` placeholders (agent env wins).

### Visual flows instead of ad-hoc scripts

Build automation graphs: check for image updates, pull, recreate containers, apply Compose, wait for healthy, ask for approval, notify (Slack / Discord / webhooks), branch with IF / CASE, fan out with Split / Join, roll back to a previous digest, or call another flow as a subflow.

Flows can run manually, on a cron (with timezone and blackout windows), or as dry-runs that skip side effects. When something needs a human, the dashboard inbox and notifications surface it.

### Full run history and ops inbox

Every flow execution is a run with steps, context, digests, and outcomes. Nested `run_flow` runs stay linked to the parent. The runs page supports search, filters, pagination, and live updates while work is active. Approvals and failures show up where you can act.

### Accounts, secrets, audit

Role-based users (modify / monitor), encrypted secrets (registry credentials, tokens, headers), reusable message templates, webhook endpoints, audit logs, and in-app notifications.

### Stack (for orientation)

Next.js UI + Express API, SQLite, Socket.IO (UI + agents) and optional gRPC for agents. Shared wire protocol: [protocol/PROTOCOL.md](protocol/PROTOCOL.md).

Companion repo: **SentryDockAgent**.

---

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

First boot (empty DB): sign in as `admin` / `admin` — you must change the password. Afterwards use your own credentials.

Docker:

```bash
docker compose up -d --build
```

HTTP `:3000`, gRPC `:50051`, data in volume `sentrydock-data`.

### Connect an agent

1. **Agents → Create** → copy the token  
2. On the agent host / **SentryDockAgent** repo:

```bash
AGENT_TOKEN=... SENTRYDOCK_URL=http://localhost:3000 AGENT_TRANSPORT=ws
# or gRPC: AGENT_TRANSPORT=grpc SENTRYDOCK_GRPC_URL=localhost:50051
```

---

## Configuration

| Variable | Default | Notes |
|----------|---------|--------|
| `PORT` | `3000` | HTTP (UI + API + Socket.IO) |
| `GRPC_PORT` | `50051` | gRPC for agents |
| `DATA_DIR` | `./data` | SQLite and local files (**use a volume in Docker** — `sentrydock-data:/data` in the bundled compose) |
| `SQLITE_PATH` | `$DATA_DIR/sentrydock.sqlite` | Override SQLite file path |
| `SQLITE_ENCRYPT` | `false` | `true` / `1` / `yes` to encrypt the SQLite file at rest |
| `SQLITE_ENCRYPTION_KEY` | — | Required when `SQLITE_ENCRYPT` is on. Passphrase (hashed to a 256-bit key). **Losing it = losing the DB.** |
| `JWT_SECRET` | — | **Required in production** |
| `SECRETS_ENCRYPTION_KEY` | — | **Required in production** (~32+ chars). Encrypts secret *values* in the DB (independent of file encryption). |
| `LOG_RETENTION_DAYS` | `90` | Audit log retention |
| `MAX_PARALLEL_COMMANDS` | `20` | Parallel commands toward agents |

Never commit a production `.env`. TLS should terminate at a reverse proxy — see [DEPLOYMENT.md](DEPLOYMENT.md).

### CI / CD

Same split as Synapse / Myelin:

| System | File | When | What |
|--------|------|------|------|
| **GitHub Actions** | `.github/workflows/ci.yml` | push/PR to `main`/`master` | `pnpm install`, lint, test, typecheck |
| **Woodpecker** | `.woodpecker.yaml` | tag `V*` (e.g. `V0.1.0`) | same checks, then build/push `tiag0ss/sentrydock-server` (`latest` + version) |

Woodpecker needs secrets `DOCKER_USERNAME` / `DOCKER_PASSWORD`.

### Data at rest

- **Volume:** the Docker compose file mounts `sentrydock-data` at `/data` so the SQLite file survives image updates. Avoid `docker compose down -v` unless you intend to wipe it.
- **Secret values:** always encrypted with `SECRETS_ENCRYPTION_KEY` (AES-GCM) before storage.
- **Optional whole-DB encryption:** set `SQLITE_ENCRYPT=true` and `SQLITE_ENCRYPTION_KEY=…`. On first start with an existing plaintext DB, SentryDock encrypts it in place (`rekey`). Wrong key → startup fails. Turning encryption off later requires a manual decrypt/export; do not simply set `SQLITE_ENCRYPT=false` on an encrypted file.

### Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Watch mode |
| `pnpm build` / `pnpm start` | Production build / run |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Quality gates |
| `pnpm reset-db-keep-agents` | Wipe DB, reseed, **keep** agent tokens |

Schema lives in `server/database/structure/systemtables/` (JSON). Startup adds missing tables/columns; it does not drop them. Use `reset-db-keep-agents` after destructive schema changes if you need a clean slate without re-installing agents.

---

## Related docs

- [DEPLOYMENT.md](DEPLOYMENT.md) — TLS / reverse proxy
- [protocol/PROTOCOL.md](protocol/PROTOCOL.md) — server ↔ agent messages
- **SentryDockAgent** — Docker agent (separate repo)
