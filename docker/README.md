# Docker environments

One Dockerfile defines three independent final targets. Production stays on a
non-root distroless image; Chromium, FFmpeg, package managers, and development
sources are confined to the other targets. The root `.dockerignore` allows only
build inputs and recursively excludes local state, dependencies, and secrets.

| Target        | Compose file          | Purpose                                                               |
| ------------- | --------------------- | --------------------------------------------------------------------- |
| `production`  | `compose.yml`         | Build and run the distributable application locally                   |
| `development` | `compose.dev.yml`     | Live source editing and optional seeded media servers                 |
| `capture`     | `compose.capture.yml` | Disposable marketing capture with a separate capture-enabled frontend |

## Build and run

From the repository root:

```sh
docker build -f docker/Dockerfile --target production -t cliparr:local .
APP_KEY="$(openssl rand -base64 32)" docker compose -f docker/compose.yml up --build
```

Keep the same private `APP_KEY` for every subsequent start, backed up with `/data`.
The example generates a key for the initial start only. The published-image
installation in the website documentation requires no source checkout; this
Compose file deliberately builds the current source instead.

Ports bind to `127.0.0.1`. For an intentional LAN/VPN deployment, set
`CLIPARR_BIND_ADDRESS` to the appropriate host interface address. Cliparr has no
app-level access control; use an authenticated reverse proxy or trusted VPN for
remote access. Production runs read-only, drops capabilities, blocks privilege
escalation, and writes only to its data volume and temporary filesystem.

```sh
# On macOS/Linux, match the checkout owner's identity before the first build:
export CLIPARR_DEV_UID="$(id -u)"
export CLIPARR_DEV_GID="$(id -g)"
pnpm docker:dev:build
pnpm docker:dev:up
# Include either provider, or both:
COMPOSE_PROFILES=plex,jellyfin pnpm docker:dev:up
```

The provider profiles run their own initialization jobs; Cliparr can start before
those jobs finish. Wait for bootstrap completion before connecting a provider.
Plex bootstrap shares Plex's network namespace and only loopback is trusted.
Development credentials are public fixtures and all published development ports
are loopback-only. Browser provider login still requires the provider's normal
account/claim setup where applicable.

Custom seed downloads require both `SINTEL_URL` (HTTPS) and `SINTEL_SHA256`.
Existing movies are checked before reuse; a mismatch fails without overwriting
cached data. Downloads and bootstrap HTTP requests have bounded timeouts.

For capture, use `pnpm assets:capture` and the repository's
[marketing asset workflow](../.agents/skills/cliparr-www-assets/SKILL.md).
Capture keeps its own Compose project, volumes, generated credentials, and
loopback browser context, and publishes no host ports. Its browser and application
run as non-root users; the recorder uses the invoking user's UID/GID for output
permissions. Chromium uses Playwright's default sandbox setting and must only
load this trusted local application. Running as non-root alone does not enable
the Chromium sandbox.

## Development setup changes

The published image is unchanged for an existing install. It still listens on
port 7171, runs as UID 65532, and uses `/data`. Pulling a new image does not
change an existing `docker run` or Compose port binding.

Checkouts that build the Docker files in this repository need these updates:

- Replace direct `prod.Dockerfile`, `dev.Dockerfile`, and `capture.Dockerfile`
  builds with `docker/Dockerfile --target production|development|capture`.
- Providers no longer start by default; select their Compose profiles.
- This repository's Compose file publishes loopback unless `CLIPARR_BIND_ADDRESS`
  is set.
- `SINTEL_MD5` is removed. Custom fixtures require `SINTEL_SHA256`.
- Development processes now run as a non-root user (UID/GID 1000 by default,
  configurable with `CLIPARR_DEV_UID` and `CLIPARR_DEV_GID`). Existing root-owned
  development volumes must be migrated before startup. Production's UID 65532
  and data format stay the same; preserve existing volumes and keys.

To migrate development volumes, stop the development stack, rebuild its image,
and run this one-time ownership change. It targets only named-volume mountpoints,
not the source checkout:

```sh
docker compose -f docker/compose.dev.yml down
pnpm docker:dev:build
docker compose -f docker/compose.dev.yml run --rm --no-deps --user root cliparr \
  sh -c 'chown -R "$(id -u node):$(id -g node)" /data /pnpm/store /workspace/node_modules /workspace/apps/*/node_modules /workspace/packages/*/node_modules /workspace/tools/www-assets/node_modules'
docker compose -f docker/compose.dev.yml run --rm --no-deps --user root media-seed \
  sh -c 'chown -R "$(id -u node):$(id -g node)" /media'
```

The source checkout must permit the configured development UID to write build
outputs. Set the identity variables before both the build and startup; do not recursively
change unrelated files or discard persistent provider volumes.

## Caching and updates

The shared toolchain installs the pnpm version from root `packageManager` once.
Application dependencies are installed before sources; server and frontend builds
copy their own inputs independently. Capture installs only recorder production dependencies and its browser before
recorder sources, and runs TypeScript with Node 24's native support. It does not
retain the application build dependencies. Unused npm and Corepack are removed
from the shared toolchain after installing pnpm. Capture also removes pnpm
after browser installation; the recorder starts directly with Node. Version metadata exists only in the final
production stage, so changing it reuses dependency and compilation layers.
BuildKit cache mounts retain local package downloads. CI exports ordinary layers
to explicit `cliparr-production`, `cliparr-development`, and `cliparr-capture`
GitHub Actions cache scopes; ephemeral runners do not rely on cache-mount contents.
Compile stages run on the build platform because the server bundle and the
frontend output are architecture-independent; only the final production stage
resolves to the target platform, so multi-arch builds need no QEMU emulation
of Node, pnpm, or Vite (the release workflow still installs QEMU, but only to
smoke-test the published arm64 digest).

External image references use multi-platform index digests. Renovate tracks these
and the Dockerfile frontend, ignores locally built image names, and raises
release-worthy `fix(cliparr)` updates for the application Dockerfile. Provider
fixture updates remain `build(cliparr)` changes. Node's major and the distroless image's
Node/Debian majors are explicit choices; changing them requires a reviewed
migration. Routine updates follow the configured Saturday maintenance window.
A merged update still needs the normal manual Release workflow to reach users.

Docker CI builds all three targets. All image targets and release validation scan the
image and matching lockfile for fixable HIGH/CRITICAL vulnerabilities.
The lockfile inventory is retained as an artifact because bundled JavaScript
cannot reliably be discovered by scanning the runtime filesystem alone. This
conservatively includes production dependencies of other workspaces, too; the
lockfile scan excludes development dependencies by Trivy's default policy.
Release publication adds an SBOM and explicit provenance, tests the published
digest on both architectures, then promotes its tags. The weekly security
workflow resolves `latest` to a digest and retrieves the matching source
revision's lockfile, so newly disclosed vulnerabilities in released images can
fail the scheduled check. Unfixed findings remain outside the blocking policy;
these checks are not a claim that the images have no vulnerabilities.

## Validation

```sh
pnpm test:docker
pnpm preflight
docker compose -f docker/compose.dev.yml --profile '*' config --quiet
```

Measure cold builds, unchanged rebuilds, source-only changes, lockfile changes,
and version-only changes separately. Keep `--progress plain` logs to verify which
steps were cached; do not infer cache reuse from elapsed time alone. Run the
production smoke test with `tools/ci/smoke-image.sh IMAGE VERSION PLATFORM`; it
checks non-root/read-only operation, health, frontend serving, and restart against
the same persistent volume.
