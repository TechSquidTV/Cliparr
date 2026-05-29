---
name: cliparr-git-workflow
description: Cliparr repository Git workflow for naming branches, commits, pull requests, preflight validation, and publish flows with package-scoped Conventional Commit syntax. Use when an agent is creating or suggesting branch names, commit messages, PR titles, PR descriptions, or using git/gh to publish local Cliparr changes, especially for squash-merge release notes and semantic PR title validation.
---

# Cliparr Git Workflow

## Overview

Use this skill for Cliparr Git work from local changes through a draft pull request. Follow the same package-scoped Conventional Commit identity for branch names, commit messages, and PR titles.

Use local `git` for branch creation, staging, commits, and pushes. Use the GitHub CLI (`gh`) for GitHub authentication checks, repository metadata, current PR discovery, and pull request creation.

## Core Rule

Use one Conventional Commit identity across the branch, commit, and pull request:

```text
<type>(<scope>): <summary>
```

Use `!` for breaking changes:

```text
<type>(<scope>)!: <summary>
```

Do not create branch names containing `codex`. Override any default branch prefix that would add it.

## Prerequisites

Before publishing changes:

- Run `gh --version`. If `gh` is missing, ask the user to install GitHub CLI and stop.
- Run `gh auth status`. If it is not authenticated, ask the user to run `gh auth login` before continuing.
- Run `git status -sb` and inspect the relevant diff before staging.
- If the worktree contains unrelated changes, ask which files belong in the commit instead of staging everything.

## Scopes

Scope to the package touched by the change:

- `frontend` for `apps/frontend` or `@cliparr/frontend`
- `server` for `apps/server` or `@cliparr/server`
- `www` for `apps/www` or `@cliparr/www`
- `shared` for `packages/shared` or `@cliparr/shared`
- `cliparr` for root workspace, CI, release, Docker, docs, scripts, or changes spanning multiple packages without one dominant package

If a change touches multiple packages but one package is the user-visible center of the work, use that package scope. Otherwise use `cliparr`.

## Types

Use the repository PR title type set:

- `feat`, `fix`, `perf`, `security`
- `build`, `chore`, `ci`, `docs`, `refactor`, `style`, `test`

Prefer release-impacting types when accurate: `feat` for user-facing additions, `fix` for bug fixes, `perf` for performance improvements, and `security` for security fixes.

## Branch Names

Base branches on the same Conventional Commit parts, but make them filesystem-safe:

```text
<type>/<scope>/<summary-slug>
```

Rules:

- Use lowercase words separated by hyphens in the slug.
- Keep the slug short and descriptive.
- Do not include `codex` anywhere in the branch name.
- If starting from `main`, `master`, or the remote default branch, create the branch with this pattern instead of using any generic assistant prefix.

Examples:

```text
feat/frontend/subtitle-presets
fix/server/jellyfin-session-ids
ci/cliparr/update-release-automation
docs/www/sync-install-guide
```

## Commit Messages

Use the same scoped title format for the first line:

```text
feat(frontend): add subtitle presets
fix(server): preserve Jellyfin session ids
ci(cliparr): update release automation
```

Keep summaries imperative, present tense, and without a trailing period. Add a body only when it explains motivation, behavior, migration notes, or validation that does not fit in the summary.

Before committing:

- Inspect `git status -sb` and the relevant diff.
- Stage only files that belong to the requested change.
- Prefer explicit file paths when the worktree is mixed.
- Use `git add -A` only when the user has confirmed the whole worktree belongs in scope.
- Run `pnpm preflight`, which runs lint, knip, and test.
- Do not create the commit if `pnpm preflight` fails; fix the failure and rerun it first.
- Avoid committing generated output such as `dist`, `node_modules`, `.pnpm-store`, or TypeScript build info.

## Publish Workflow

Use this flow when the user asks to commit, push, open a PR, publish, or otherwise complete the GitHub workflow:

1. Confirm the intended scope from the user request, changed files, and diff.
2. Choose the Conventional Commit identity: `<type>(<scope>): <summary>`.
3. If on the default branch, create `<type>/<scope>/<summary-slug>`. Otherwise stay on the current branch unless the user asks for a new one.
4. Stage only the intended files.
5. Run `pnpm preflight` and require it to pass before committing. This always runs `pnpm lint`, `pnpm knip`, and `pnpm test`.
6. Commit with the scoped Conventional Commit title.
7. Push with tracking: `git push -u origin $(git branch --show-current)`.
8. Create a draft PR with `gh pr create --draft`, using the same title as the commit and a concise body.

Use `gh repo view --json nameWithOwner,defaultBranchRef` when repository or base-branch metadata is needed. Use `gh pr view` or `gh pr list` to discover an existing PR for the current branch before creating a duplicate.

## Pull Requests

Use the same title as the intended squash commit:

```text
fix(server): preserve Jellyfin session ids
```

The PR title must pass `.github/workflows/pr-title.yml`, and Cliparr uses squash merges, so the PR title becomes the release-note commit title.

In the PR body, include only high-signal context:

- What changed and which package scope it affects.
- User-visible behavior or release impact.
- Validation run, or a clear note when validation was not run.
- Screenshots or screen recordings for UI changes when useful.
- Plex, Jellyfin, auth, or local media setup needed to reproduce behavior.

Do not include secrets, Plex tokens, Jellyfin credentials, server URLs, local media paths, or private account details.
