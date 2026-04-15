# syntax=docker/dockerfile:1.7

FROM node:24-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

FROM base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/frontend/package.json apps/frontend/package.json

RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.base.json ./
COPY apps/server/tsconfig.json apps/server/tsconfig.build.json apps/server/
COPY apps/server/src apps/server/src
COPY apps/frontend/components.json apps/frontend/index.html apps/frontend/tsconfig.json apps/frontend/vite.config.js apps/frontend/
COPY apps/frontend/public apps/frontend/public
COPY apps/frontend/src apps/frontend/src

RUN pnpm build
RUN pnpm --filter @cliparr/server deploy --legacy --prod /prod/apps/server

FROM node:24-slim AS runner

ENV NODE_ENV=production
ENV PORT=3000
ENV CLIPARR_DATA_DIR=/data

WORKDIR /app

COPY --from=build --chown=node:node /prod/apps/server ./apps/server
COPY --from=build --chown=node:node /app/apps/frontend/dist ./apps/frontend/dist

RUN mkdir -p /data && chown node:node /data

USER node

VOLUME ["/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "apps/server/dist/server.js"]
