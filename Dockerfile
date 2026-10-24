# Image de production : l'API sert aussi l'interface construite (une seule origine).
#   docker build -t coach-maths .
#   docker compose --profile app up -d   (voir docker-compose.yml et docs/DEPLOIEMENT.md)

# ── 1. Construction de l'interface ───────────────────────────────
FROM node:24-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build

# ── 2. Dépendances de l'API, sans les outils de développement ────
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --no-audit --no-fund -w @mathsuivi/api -w @mathsuivi/shared

# ── 3. Image finale ──────────────────────────────────────────────
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=3001 \
    FILES_DIR=/data/files
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY package.json ./
COPY packages/shared packages/shared
COPY apps/api/package.json apps/api/
COPY apps/api/src apps/api/src
COPY --from=web /app/apps/web/dist apps/web/dist
# Fichiers importés (chiffrés) : à monter sur un volume sauvegardé.
RUN mkdir -p /data/files && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/sante').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
