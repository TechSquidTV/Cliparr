# syntax=docker/dockerfile:1.25
FROM node:24.14.0-bookworm-slim
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends ffmpeg curl jq && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY tools/www-assets/package.json tools/www-assets/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cliparr/www-assets exec playwright install --with-deps chromium
COPY config config
COPY packages/shared packages/shared
COPY apps/frontend apps/frontend
COPY apps/server apps/server
COPY tools/www-assets tools/www-assets
COPY docker/bootstrap-jellyfin.sh docker/bootstrap-jellyfin.sh
RUN VITE_CLIPARR_ASSET_CAPTURE=true pnpm --filter @cliparr/frontend build && pnpm --filter @cliparr/server build
ENV NODE_ENV=production
