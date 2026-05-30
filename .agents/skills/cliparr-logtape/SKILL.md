---
name: cliparr-logtape
description: >
  Use this skill when changing, reviewing, or adding Cliparr LogTape logging in
  frontend, server, shared helpers, or tests. Covers Cliparr category taxonomy,
  wide-event boundaries, flat dot-notated fields, context, redaction/noise
  rules, no-console enforcement, and validation for logging PRs.
---

# Cliparr LogTape Logging

## Purpose

Use this skill for Cliparr-specific logging work. It does not replace the
upstream LogTape docs; it records Cliparr's local policy for categories,
structured fields, wide events, and validation.

## Start Here

- Read current logging setup before editing:
  - `apps/server/src/logging.ts`
  - `apps/frontend/src/logging.ts`
  - `packages/shared/src/logging.ts`
- Search existing usage with:
  - `rg -n "get(Server|Frontend)Logger|logEventFields|console\\." apps packages`
- Preserve runtime behavior unless the user explicitly asks for behavior
  changes. Logging edits should not alter response bodies, media behavior, or
  export semantics.

## Logger Access

- Server app code uses `getServerLogger(...)`.
- Frontend app code uses `getFrontendLogger(...)`.
- Do not import or call raw `getLogger()` in Cliparr app code except inside the
  logging setup helpers.
- Use array hierarchy segments, not dotted single-string categories:

```typescript
const logger = getFrontendLogger(["editor", "playback"]);
const proxyLogger = getServerLogger(["media", "proxy"]);
```

- Use `logger.getChild("subsystem")` when one file owns several child
  categories, such as media route logging.

## Category Taxonomy

Keep Cliparr application logs under the app root:

- Frontend: `["cliparr", "frontend", ...]`
- Server: `["cliparr", "server", ...]`

Keep LogTape internals separate and explicit:

- `["logtape", "meta"]` is reserved for LogTape configuration/sink diagnostics.
- Configure the meta category at `warning`.
- Never pass `["logtape", "meta"]` through `getServerLogger()` or
  `getFrontendLogger()`.

Use these domain categories:

- `frontend.editor.playback`
- `frontend.editor.export`
- `frontend.editor.subtitle`
- `frontend.editor.artwork`
- `frontend.source`
- `server.lifecycle`
- `server.http.request`
- `server.http.error`
- `server.db`
- `server.session`
- `server.session.store`
- `server.provider.auth`
- `server.provider.plex.playback`
- `server.provider.jellyfin.playback`
- `server.source`
- `server.media.discovery`
- `server.media.local_url`
- `server.media.proxy`

Categories describe ownership and filtering. Keep `event.name` as the stable
operation name.

## Structured Fields

- Use flat dot-notated keys only, e.g. `"event.name"`, `"request.id"`,
  `"provider.id"`, `"media.handle.id"`, `"error.code"`.
- Use helpers from `@cliparr/shared/logging`:
  - `logEventFields(name, outcome)`
  - `logDurationFields(startedAt)`
  - `logErrorFields(err)`
  - `compactLogFields(fields)`
  - `sanitizeUrlForLog(value)`
- Use `logger.with()` for repeated explicit context such as
  `"editor.session.id"` and provider IDs.
- Server request context is implicit via `withContext()`; keep request fields
  flat and dot-notated.
- For actual `Error` objects, use `warnWithError`, `errorWithError`, or
  `fatalWithError` so LogTape receives the error object directly with extra
  fields.

## Wide Events And Noise

Prefer one structured summary per meaningful operation/outcome. Hot-path media
internals stay at `trace`; recoverable failures use `warning`; real operation
failures use `error` or `fatal`.

- HTTP requests: completion at `trace`; slow or 5xx summaries at `warning`.
- Provider auth/session: auth start, poll complete/expired/fail, credential
  login complete/fail, restore, logout.
- Sources: update, delete, check, and refresh-all summaries.
- Playback discovery: `/api/media/currently-playing` as one aggregate event.
- Media handles/proxy: creation, reuse, retries, cache, and playlist rewrite at
  `trace`; missing handles, unsafe URLs, upstream failures, and stream failures
  at `warning`/`error`.
- Editor playback: one source-attempt event for success, degraded, and failure.
- Editor export: start, success, and failure.
- Subtitle/artwork: concise load success/failure summaries.

Do not log full track arrays, full media metadata, subtitle text, or repeated
per-frame/per-chunk details by default.

## Redaction Rules

Never log:

- tokens, cookies, passwords, or credentials
- raw auth URLs
- raw media URLs with query strings
- subtitle text
- full media metadata arrays
- usernames if they are not necessary for debugging

Prefer IDs, counts, booleans, sanitized origin/path, status codes, durations,
and failure categories.

## No Console

- Do not add `console.*`.
- ESLint `no-console` enforces this.
- CLI/user-facing scripts should use `process.stdout.write` or
  `process.stderr.write` instead of `console.*`.

## Before Editing Checklist

- Identify the operation boundary and decide whether it needs a wide event or
  lower-level `trace`.
- Pick the category from the taxonomy above.
- Reuse existing helpers and context patterns.
- Confirm the data is high-value for debugging and low-noise in normal use.
- Check that sensitive values are omitted or sanitized.

## Validation

For logging changes, run:

- `pnpm --filter @cliparr/server lint`
- `pnpm --filter @cliparr/frontend lint`
- `pnpm knip`
- `rg -n "console\\." . --glob '!node_modules' --glob '!dist' --glob '!*.lock'`

Before committing or updating a PR, run:

- `pnpm preflight`

When category output matters, use a server test that emits logs and confirm
sample categories render as `cliparr.server.*`; frontend categories should
compile through `getFrontendLogger()`.
