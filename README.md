# SentryDock Server

Painel central: Next.js + Express, agentes via WebSocket ou gRPC, fluxos visuais, updates de imagens.

## Desenvolvimento

```bash
cp .env.example .env
pnpm install
pnpm dev
```

Abre http://localhost:3000 — na primeira subida o login é `admin` / `admin` (é obrigatório mudar a password).

## Docker

```bash
docker compose up -d --build
```

Dados SQLite em volume `sentrydock-data` (`DATA_DIR=/data`).

## Base de dados

Esquema em JSON (`server/database/structure/systemtables/`). No arranque o `schemaBuilder` cria tabelas e adiciona colunas em falta (estilo Myelin, só SQLite). Não uses ficheiros de migration SQL.

## TLS

Em produção termina TLS num reverse proxy (Caddy/Traefik/Nginx) para `:3000` e, se usares gRPC, configura TLS no proxy ou `GRPC` com certificados. Os agentes devem usar `https://` / endpoint seguro.

## Protocolo

Ver [protocol/PROTOCOL.md](protocol/PROTOCOL.md).
