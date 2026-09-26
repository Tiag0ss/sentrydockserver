# Deployment notes (TLS / reverse proxy)

## HTTP(S)

Recommended: terminate TLS at a reverse proxy in front of the SentryDock server container (port 3000).

Example Caddy:

```
sentrydock.example.com {
  reverse_proxy sentrydock:3000
}
```

Agents then set `SENTRYDOCK_URL=https://sentrydock.example.com`.

## gRPC

Expose port 50051 (or terminate gRPC-web/TLS at the proxy). Agents set `SENTRYDOCK_GRPC_URL=host:50051` and `AGENT_TRANSPORT=grpc`.

## Secrets

Set strong `JWT_SECRET` and `SECRETS_ENCRYPTION_KEY` (any string hashed to AES key). Never commit production `.env`.

## SQLite persistence and encryption

- Persist `/data` with a volume (`sentrydock-data` in `docker-compose.yml`).
- Optional at-rest encryption of the whole SQLite file:

```bash
SQLITE_ENCRYPT=true
SQLITE_ENCRYPTION_KEY=long-random-passphrase
```

`SECRETS_ENCRYPTION_KEY` still encrypts registry/token secret *columns*; `SQLITE_ENCRYPT` protects the entire database file if the volume is copied. Keep both keys only in env/secrets manager — losing `SQLITE_ENCRYPTION_KEY` makes the DB unreadable.