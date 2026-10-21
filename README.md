[![Docker Hub](https://img.shields.io/docker/pulls/tiag0ss/sentrydock-server?label=Docker%20Pulls&logo=docker)](https://hub.docker.com/r/tiag0ss/sentrydock-server)
[![Docker Image](https://img.shields.io/badge/Docker%20Hub-tiag0ss%2Fsentrydock--server-blue?logo=docker)](https://hub.docker.com/r/tiag0ss/sentrydock-server)

# SentryDockServer

Control plane for **SentryDock**: manage Docker hosts, image catalogs, Compose stacks, and visual update flows from one UI.

It does **not** talk to Docker directly. Remote hosts run [SentryDockAgent](https://github.com/Tiag0ss/SentryDockAgent), which connects **outbound** to this server. You operate the fleet here; agents execute on the machines.

This project is **functional** and usable day-to-day, but still in an **early stage** — expect rough edges. Please report bugs and ideas on GitHub.

## Features

- 🖥️ **Fleet dashboard** — Agents online/offline, inventory (disk, dangling images, container counts), live updates over Socket.IO
- 📦 **Image catalog** — Follow a tag, pin a tag, or semver range; reference images in Compose as `${SD_IMAGE_<key>}`
- 📄 **Compose as source of truth** — Store YAML in the panel, deploy to selected agents, track sync / drift; secrets + agent env fill `${VAR}`
- 🔀 **Visual flows** — Pull, recreate, apply Compose, wait healthy, approve, notify (Slack / Discord / webhooks), IF / CASE, Split / Join, rollback digest, subflows
- ⏰ **Scheduling** — Cron with timezone and blackout windows; manual and dry-run modes
- 📊 **Container metrics** — Per-agent CPU/memory history on the dashboard; start / stop / restart from the UI
- 📬 **Runs & inbox** — Step history, digests, live run updates, approvals and failure notifications
- 🔐 **Users & secrets** — Roles (modify / monitor), encrypted secrets, audit logs, message templates, webhooks
- ✨ **What’s New** — In-app release notes since the last seen version
- 🌍 **i18n & themes** — English, Portuguese (PT), Spanish, French; light / dark / system palettes

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js, React, TypeScript |
| Backend | Node.js, Express, TypeScript (custom server) |
| Database | SQLite (optional at-rest encryption) |
| Real-time | Socket.IO (UI + agents); optional gRPC for agents |
| Container | Alpine-based Node.js image — [`tiag0ss/sentrydock-server`](https://hub.docker.com/r/tiag0ss/sentrydock-server) |

Wire protocol: [protocol/PROTOCOL.md](protocol/PROTOCOL.md).

## Local Development

```bash
git clone https://github.com/Tiag0ss/sentrydockserver.git
cd sentrydockserver
cp .env.example .env
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

First boot (empty DB): sign in as `admin` / `admin` — you must change the password.

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm build && pnpm start
```

## Quick Start (Docker)

### From Docker Hub

```bash
docker run -d \
  --name sentrydock-server \
  -p 3000:3000 \
  -p 50051:50051 \
  -e JWT_SECRET=change-me-in-production \
  -e SECRETS_ENCRYPTION_KEY=change-me-32-bytes-minimum-secret!! \
  -e DATA_DIR=/data \
  -v sentrydock-data:/data \
  tiag0ss/sentrydock-server:latest
```

### Build locally

```bash
cp .env.example .env
# set JWT_SECRET and SECRETS_ENCRYPTION_KEY
docker compose up -d --build
```

HTTP `:3000`, gRPC `:50051`, SQLite on volume `sentrydock-data`.

### Connect an agent

1. **Agents → Create** → copy the token  
2. On the host, run [SentryDockAgent](https://hub.docker.com/r/tiag0ss/sentrydock-agent) with that token (see agent README).

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP (UI + API + Socket.IO) |
| `GRPC_PORT` | No | `50051` | gRPC for agents |
| `DATA_DIR` | No | `./data` | SQLite and local files (**use a volume in Docker**) |
| `SQLITE_PATH` | No | `$DATA_DIR/sentrydock.sqlite` | Override SQLite path |
| `SQLITE_ENCRYPT` | No | `false` | Encrypt the SQLite file at rest |
| `SQLITE_ENCRYPTION_KEY` | If encrypting | — | Passphrase for DB file encryption. **Losing it = losing the DB.** |
| `JWT_SECRET` | **Yes (prod)** | — | Session / API JWT secret |
| `SECRETS_ENCRYPTION_KEY` | **Yes (prod)** | — | Encrypts secret *values* in the DB (~32+ chars) |
| `LOG_RETENTION_DAYS` | No | `90` | Audit log retention |
| `MAX_PARALLEL_COMMANDS` | No | `20` | Parallel commands toward agents |

Never commit a production `.env`. Terminate TLS at a reverse proxy — see [DEPLOYMENT.md](DEPLOYMENT.md).

## Ports

| Port | Description |
|------|-------------|
| `3000` | UI + API + Socket.IO |
| `50051` | gRPC (agents) |

## Volumes

| Path | Description |
|------|-------------|
| `/data` | SQLite DB and server-side files (`DATA_DIR`) |

Avoid `docker compose down -v` unless you intend to wipe the database.

## CI / CD

| System | File | When | What |
|--------|------|------|------|
| **GitHub Actions** | `.github/workflows/ci.yml` | push/PR to `main`/`master` | install, lint, test, typecheck |
| **Woodpecker** | `.woodpecker.yaml` | tag `V*` (e.g. `V0.2.3`) | checks, then build/push `tiag0ss/sentrydock-server` (`latest` + version) |

## Updating

```bash
docker pull tiag0ss/sentrydock-server:latest
docker compose up -d
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Watch mode |
| `pnpm build` / `pnpm start` | Production build / run |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Quality gates |
| `pnpm whats-new:generate` | Rebuild What’s New changelog from git version bumps |
| `pnpm reset-db-keep-agents` | Wipe DB, reseed, **keep** agent tokens |

## Related

- 🐳 [Docker Hub — server](https://hub.docker.com/r/tiag0ss/sentrydock-server)
- 🐳 [Docker Hub — agent](https://hub.docker.com/r/tiag0ss/sentrydock-agent)
- 🤖 [SentryDockAgent](https://github.com/Tiag0ss/SentryDockAgent) — per-host Docker worker
- 📖 [DEPLOYMENT.md](DEPLOYMENT.md) — TLS / reverse proxy
- 🔌 [protocol/PROTOCOL.md](protocol/PROTOCOL.md) — server ↔ agent messages

## License

MIT
