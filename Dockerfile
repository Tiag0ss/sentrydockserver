# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* .npmrc* pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile || pnpm install

FROM node:22-bookworm-slim AS builder
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
RUN groupadd -r app && useradd -r -g app -d /app app \
  && mkdir -p /data && chown -R app:app /data /app
COPY --from=builder --chown=app:app /app/package.json ./
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/.next ./.next
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/protocol ./protocol
COPY --from=builder --chown=app:app /app/server/database/structure ./server/database/structure
COPY --from=builder --chown=app:app /app/next.config.ts ./
USER app
EXPOSE 3000 50051
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
