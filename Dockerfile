# syntax=docker/dockerfile:1.25

ARG CLIPARR_VERSION
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

FROM base AS build

ARG CLIPARR_VERSION
ENV CLIPARR_VERSION=$CLIPARR_VERSION

COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.base.json ./
COPY packages/shared/src packages/shared/src
COPY apps/server/tsconfig.json apps/server/tsconfig.build.json apps/server/tsdown.config.ts apps/server/
COPY apps/server/drizzle apps/server/drizzle
COPY apps/server/src apps/server/src
COPY apps/frontend/components.json apps/frontend/index.html apps/frontend/tsconfig.json apps/frontend/vite.config.js apps/frontend/
COPY apps/frontend/public apps/frontend/public
COPY apps/frontend/src apps/frontend/src

RUN CLIPARR_SERVER_SOURCEMAP=false pnpm build

RUN mkdir -p /runtime/data && chown 65532:65532 /runtime/data

FROM gcr.io/distroless/nodejs${NODE_VERSION}-debian13:nonroot AS runner

ARG CLIPARR_VERSION

LABEL org.opencontainers.image.title="Cliparr" \
  org.opencontainers.image.description="Instant media clipper for Plex and Jellyfin servers." \
  org.opencontainers.image.source="https://github.com/techsquidtv/cliparr" \
  org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
ENV PORT=7171
ENV CLIPARR_DATA_DIR=/data
ENV CLIPARR_VERSION=$CLIPARR_VERSION

WORKDIR /app

COPY --from=build --chown=65532:65532 /runtime/data /data
COPY --from=build --chown=65532:65532 /app/apps/server/package.json ./apps/server/package.json
COPY --from=build --chown=65532:65532 /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=65532:65532 /app/apps/server/drizzle ./apps/server/drizzle
COPY --from=build --chown=65532:65532 /app/apps/frontend/dist ./apps/frontend/dist

USER 65532:65532

VOLUME ["/data"]

EXPOSE 7171

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 7171) + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["apps/server/dist/server.js"]
