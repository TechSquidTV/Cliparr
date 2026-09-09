# Contributing

Thanks for helping improve Cliparr.

## Development

Requirements:

- Node.js 24 or newer
- pnpm 11.2.2 via Corepack, matching the root `packageManager`
- A Plex or Jellyfin server, or a local video file, for manual end-to-end testing

Install dependencies:

```sh
pnpm install
cp .env.example .env
# Set APP_KEY in .env with a stable random value, for example:
# openssl rand -base64 32
```

Run the development server:

```sh
pnpm dev
```

Open the app at http://localhost:5173. The API server runs on http://localhost:3000 and redirects auth callback pages back to the Vite frontend during development.

Before opening a pull request, run:

```sh
pnpm preflight
```

## Pull Requests

- Keep changes focused and explain the user-visible behavior they affect.
- Use a Conventional Commit pull request title, such as `feat: add subtitle presets`, `fix: preserve Jellyfin session ids`, or `ci: update release automation`.
- Use `!` for breaking changes, for example `feat!: replace export settings format`.
- Include screenshots or short screen recordings for UI changes when helpful.
- Note any Plex setup needed to reproduce provider/session behavior.
- Avoid committing generated output such as `dist`, `node_modules`, `.pnpm-store`, or TypeScript build info files.

Cliparr uses squash merges, and the squash commit title comes from the pull request title. The release workflow uses those titles to choose the next SemVer version and build release notes.

Release-impacting title types:

- `feat` creates a minor release.
- `fix`, `perf`, `security`, and `build(deps)` create a patch release.
- A breaking `!` creates a major release.
- `docs`, `ci`, `chore`, `refactor`, `test`, `style`, and other `build` changes are included in notes but do not trigger a release by themselves.

## Releases

GitHub Releases are the canonical changelog. The `Release` workflow is run manually from `main`, computes the next SemVer version from committed squash/merge titles, publishes Docker images to GHCR, creates the GitHub Release, and triggers a Cloudflare Pages rebuild so `cliparr.dev/changelog` mirrors the latest release notes.

Before running a real release, make sure `CLOUDFLARE_PAGES_DEPLOY_HOOK_URL` is configured as a repository secret. Cloudflare Pages builds require a read-only `GITHUB_TOKEN` or `GH_TOKEN` environment variable so the changelog mirror does not hit unauthenticated GitHub API rate limits. Use the workflow's dry-run mode first when validating a release.

## Security

Do not include Plex tokens, Jellyfin credentials, server URLs, local media paths, or other private account details in issues, logs, screenshots, or pull requests.

### Release validation and recovery

Every workspace test script runs in CI and release validation, including the website. Job summaries show the embedded app version, tested commit (including the distinction between a PR head and its tested merge), actual runner/container Node versions, pnpm version, and validation outcomes.

Release planning uses immutable commit titles; editing a merged PR title no longer changes the version. RCs require new commits since the preceding candidate. Stable releases remain allowed without an RC, and summaries report whether the target matches the latest candidate. Stable notes include all changes since the previous stable release; RC notes use the previous candidate where available.

Dry runs build both architectures and smoke-test the local amd64 image, generate preview notes, and publish nothing. Real runs push a run-specific staging tag, smoke-test the resulting registry digest on amd64 and on arm64 through QEMU, create/update the GitHub release, then promote that tested digest to the version and channel tags. Staging tags use `run-<run-id>-<attempt>` and are diagnostic artifacts, not supported update channels.

If publication fails, **rerun the same workflow run** to reuse its saved release plan (retained for 30 days), rather than starting another dispatch that could calculate a different version. Existing GitHub releases are updated only after verifying their tag targets the planned commit. Conflicting tags and superseded stable plans stop recovery. A retry rebuilds and retests its image before promotion, so its digest can change. GitHub and GHCR publication is not atomic; the summary identifies partial publication and which stages completed.

The Cloudflare changelog refresh is a separate job. If only that job fails, rerun the failed job; the release is already published. To retry an older refresh independently, use the Sync Changelog workflow.
