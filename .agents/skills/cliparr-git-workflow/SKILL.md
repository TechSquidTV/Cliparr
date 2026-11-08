---
name: cliparr-git-workflow
description: Apply Cliparr conventions to branches, commits, PRs, release impact, and requested GitHub publishing.
---

# Cliparr Git Workflow

## Naming and releases

Commits and squash PR titles use `<type>(<scope>): <summary>`; insert `!` before `:` for breaking changes. Keep summaries imperative, without a trailing period. Align branch, commit, and PR with the final change.

- Branches: `<type>/<scope>/<short-lowercase-hyphenated-slug>`. No agent branding.
- Scopes: `frontend`, `server`, `www` for their `apps/` directories; `shared`, `plex` for their `packages/` directories. Use the dominant user-visible package for cross-package work, otherwise `cliparr`; use `cliparr` for root, CI, release, Docker, docs, and scripts. Dependency-only updates use `build(deps)`.
- Types: `feat`, `fix`, `perf`, `security`, `build`, `chore`, `ci`, `docs`, `refactor`, `style`, `test`.
- Release exceptions: `security` and `build(deps)` trigger patch releases. Scope `www` never triggers an app release, even with `!`.

The squash PR title determines release impact. Rules live in `tools/release/conventional.mjs` and `.github/workflows/pr-title.yml`.

## Breaking changes

Compatibility protects users and self-hosters, including widely used undocumented workflows. A change is breaking when an upgrade requires changing existing setup or usage to keep working, loses saved state, or removes a supported capability.

Examples: renaming environment variables; changing required deployment configuration; forcing reauthentication; removing export formats; raising minimum browser, Plex, or Jellyfin requirements. Security fixes follow the same rule when they invalidate supported setups or workflows.

Transparent automatic migrations preserving data and behavior, internal refactors, and coordinated frontend/server changes are not inherently breaking. `/api` and workspace packages are internal; changing them alone does not require `!`. Judge user/operator impact, not code churn or whether behavior was documented.

For breaking changes, use `!` in commit/PR titles and explicitly warn affected users: explain the old/new behavior and required upgrade actions or lost capabilities. Do not add compatibility aliases or fallbacks.

## Execution

- Honor the requested endpoint: commit stays local; push does not imply a PR; publish means commit → push → draft PR. Use `git` locally and `gh` for GitHub; missing CLI/auth blocks only GitHub steps.
- Inspect status and diff; stage only intended changes, using explicit paths in mixed worktrees. Ask only if scope is ambiguous. Exclude build artifacts; preserve required tracked generated files.
- Create a conventionally named branch from the default branch or detached HEAD; otherwise reuse the branch unless asked for a new one.
- Run `pnpm preflight` before every commit. Fix failures and rerun; never commit on failure.
- When publishing, check GitHub authentication, discover the repository/default branch and any existing branch PR, push with tracking, and create a draft only if no PR exists.
- PR bodies explain final behavior, release/upgrade impact, and validation; add reproduction setup or visuals when useful. Exclude credentials, private server URLs, local media paths, and account details.
