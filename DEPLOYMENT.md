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
