---
name: cliparr-logtape
description: Apply Cliparr LogTape categories, structured fields, operation summaries, and redaction rules when adding, changing, or reviewing logging.
---

# Cliparr LogTape

Read `apps/{server,frontend}/src/logging.ts` and `packages/shared/src/logging.ts`; find usage with `rg -n 'get(Server|Frontend)Logger|logEventFields|console\.' apps packages`. Logging-only changes must preserve response bodies, media behavior, and export semantics.

## Categories and fields

- Use `getServerLogger` / `getFrontendLogger`, which prepend `["cliparr", "server"]` / `["cliparr", "frontend"]`. Raw `getLogger()` belongs only in logging setup helpers.
- Pass hierarchy segments, e.g. `["editor", "playback"]`, never a dotted single string. Use `logger.getChild("subsystem")` for file-owned child categories.
- Reserve `["logtape", "meta"]` for configuration/sink diagnostics at `warning`; configure it directly, never through app helpers.

Domain taxonomy below the app root (dots denote hierarchy):

- Frontend: `editor.playback`, `editor.export`, `editor.subtitle`, `editor.artwork`, `source`.
- Server: `lifecycle`, `http.request`, `http.error`, `db`, `session`, `session.store`, `session.media_handles`, `provider.auth`, `provider.plex.playback`, `provider.jellyfin.playback`, `source`, `media.discovery`, `media.local_url`, `media.proxy`.

Categories identify ownership/filtering; `event.name` identifies the stable operation. Fields must be flat, dot-notated keys: `request.id`, `provider.id`, `media.handle.id`, `error.code`.

Reuse `@cliparr/shared/logging`: `logEventFields(name, outcome)`, `logDurationFields(startedAt)`, `logErrorFields(err)`, `compactLogFields(fields)`, `sanitizeUrlForLog(value)`. Repeat explicit context with `logger.with()` (e.g. `editor.session.id`, provider IDs); server request context is implicit through `withContext()`, also flat. Pass actual `Error` objects through `warnWithError`, `errorWithError`, or `fatalWithError` to retain the error and extra fields.

## Operation boundaries and noise

Prefer one summary per meaningful operation/outcome. Hot media internals use `trace`, recoverable failures `warning`, operation failures `error`/`fatal`.

- HTTP: completion `trace`; slow/5xx summaries `warning`.
- Auth/session: start, poll complete/expired/fail, credential login complete/fail, restore, logout.
- Sources: update, delete, check, refresh-all summaries.
- Discovery: one aggregate `/api/media/currently-playing` event.
- Handles/proxy: creation, reuse, retries, cache, playlist rewrite `trace`; missing handles, unsafe URLs, upstream/stream failures `warning`/`error`.
- Editor playback: one source-attempt event for success/degraded/failure. Export: start/success/failure. Subtitles/artwork: concise load success/failure.

Never log credentials (including tokens/cookies/passwords), raw auth URLs, query-bearing media URLs, subtitle text, full track/metadata arrays, or unnecessary usernames. Prefer IDs, counts, booleans, sanitized origin/path, statuses, durations, and failure categories. No repeated per-frame/per-chunk details by default.

Do not add `console.*` (ESLint enforced); CLI/user-facing scripts use `process.stdout.write` / `process.stderr.write`.

## Validation

Run `pnpm --filter @cliparr/server lint`, `pnpm --filter @cliparr/frontend lint`, `pnpm knip`, and `rg -n 'console\.' . --glob '!node_modules' --glob '!dist' --glob '!*.lock'`. Run `pnpm preflight` before committing or updating a PR. When category output matters, confirm emitted server test logs render `cliparr.server.*` and frontend categories compile through `getFrontendLogger()`.
