# syntax=docker/dockerfile:1.28.0@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b

# Compile stages run on the build platform: their outputs (the bundled server
# and the static frontend) are architecture-independent, so multi-arch builds
# never emulate Node, pnpm, or Vite under QEMU. Only the final production
# stage resolves to the target platform. The development and capture targets
# are built for the host platform in every supported flow, where the build
# platform is the target platform.
FROM --platform=$BUILDPLATFORM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS toolchain
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV npm_config_store_dir=/pnpm/store
WORKDIR /workspace
COPY package.json /tmp/cliparr-package.json
RUN npm uninstall --global corepack \
  && npm install --global "$(node -p 'require("/tmp/cliparr-package.json").packageManager')" \
  && rm /tmp/cliparr-package.json \
  && npm uninstall --global npm

FROM toolchain AS development
ARG DEV_UID=1000
ARG DEV_GID=1000
RUN groupmod --non-unique --gid "$DEV_GID" node \
  && usermod --uid "$DEV_UID" --gid "$DEV_GID" node
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl jq procps unzip \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data /media /pnpm/store node_modules \
    apps/server/node_modules apps/frontend/node_modules apps/www/node_modules \
    packages/shared/node_modules packages/plex/node_modules tools/www-assets/node_modules \
  && chown -R node:node /data /media /pnpm /workspace
COPY docker/bootstrap-jellyfin.sh docker/seed-media.sh /opt/cliparr/docker/
USER node
CMD ["pnpm", "dev:docker"]

FROM --platform=$BUILDPLATFORM toolchain AS manifests
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY apps/www/package.json apps/www/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/plex/package.json packages/plex/package.json
COPY tools/www-assets/package.json tools/www-assets/package.json

FROM --platform=$BUILDPLATFORM manifests AS app-deps
RUN --mount=type=cache,id=cliparr-pnpm,target=/pnpm/store \
  pnpm install --filter @cliparr/server... --filter @cliparr/frontend... --frozen-lockfile

FROM --platform=$BUILDPLATFORM app-deps AS app-source
COPY config/tsconfig.json config/tsconfig.base.json config/
COPY packages/shared/src packages/shared/src

FROM --platform=$BUILDPLATFORM app-source AS server-build
COPY packages/plex/src packages/plex/src
COPY apps/server/tsconfig.json apps/server/tsconfig.build.json apps/server/tsdown.config.ts apps/server/
COPY apps/server/src apps/server/src
RUN CLIPARR_SERVER_SOURCEMAP=false pnpm --filter @cliparr/server build
COPY apps/server/drizzle apps/server/drizzle
RUN mkdir -p /runtime/data && chown 65532:65532 /runtime/data

FROM --platform=$BUILDPLATFORM app-source AS frontend-source
COPY apps/frontend/components.json apps/frontend/index.html apps/frontend/tsconfig.json apps/frontend/vite.config.js apps/frontend/
COPY apps/frontend/public apps/frontend/public
COPY apps/frontend/src apps/frontend/src

FROM --platform=$BUILDPLATFORM frontend-source AS frontend-build
RUN pnpm --filter @cliparr/frontend build

FROM --platform=$BUILDPLATFORM frontend-source AS capture-frontend-build
RUN VITE_CLIPARR_ASSET_CAPTURE=true pnpm --filter @cliparr/frontend build

FROM manifests AS capture-tools
RUN --mount=type=cache,id=cliparr-pnpm,target=/pnpm/store \
  pnpm install --filter @cliparr/www-assets... --prod --ignore-scripts --frozen-lockfile
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl jq \
  && pnpm --filter @cliparr/www-assets exec playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/pnpm /usr/local/bin/pnpm /usr/local/bin/pnpx

FROM capture-tools AS capture
COPY packages/shared/src packages/shared/src
COPY tools/www-assets/src tools/www-assets/src
COPY docker/bootstrap-jellyfin.sh docker/bootstrap-jellyfin.sh
COPY --from=server-build /workspace/apps/server/dist apps/server/dist
COPY --from=server-build /workspace/apps/server/drizzle apps/server/drizzle
COPY --from=capture-frontend-build /workspace/apps/frontend/dist apps/frontend/dist
RUN mkdir -p /data /output && chown node:node /data /output
ENV NODE_ENV=production
WORKDIR /workspace/tools/www-assets
USER node
CMD ["node", "src/record.ts"]

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:cb606325b7ec4af55462cb0b424a53b452a5b4a894ffe841fcf1048d216fb9f8 AS production
LABEL org.opencontainers.image.title="Cliparr" \
  org.opencontainers.image.description="Instant media clipper for Plex and Jellyfin servers." \
  org.opencontainers.image.source="https://github.com/techsquidtv/cliparr" \
  org.opencontainers.image.licenses="MIT"
WORKDIR /app
COPY --from=server-build --chown=65532:65532 /runtime/data /data
COPY --from=server-build /workspace/apps/server/package.json apps/server/package.json
COPY --from=server-build /workspace/apps/server/dist apps/server/dist
COPY --from=server-build /workspace/apps/server/drizzle apps/server/drizzle
COPY --from=frontend-build /workspace/apps/frontend/dist apps/frontend/dist
# Version metadata is runtime configuration; changing it must not recompile the app.
# Local builds default to "local"; CI and releases always pass an explicit version.
ARG CLIPARR_VERSION=local
ENV NODE_ENV=production
ENV PORT=7171
ENV CLIPARR_DATA_DIR=/data
ENV CLIPARR_VERSION=$CLIPARR_VERSION
USER 65532:65532
VOLUME ["/data"]
EXPOSE 7171
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 7171) + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["apps/server/dist/server.js"]
