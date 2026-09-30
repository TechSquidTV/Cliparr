# Plex contracts

`@cliparr/plex` is a source-only workspace package consumed by the server and the
standalone Node 24 development bootstrap. It has no runtime dependencies or
server imports. Production server builds bundle it; bootstrap runs its TypeScript
with Node's built-in type stripping, without installing the application.

## Ownership and regeneration

- `openapi/pms.json` is the normalized official Redoc snapshot from
  <https://developer.plex.tv/pms/>. `openapi/manifest.json` records its hash,
  generator version, and original retrieval provenance. It is not patched in place.
- `openapi/pms-supplement.json` contains local corrections, with rationale and
  source on every change. Property edits compare expected old values. Route
  corrections fingerprint their source operation and reject overlapping upstream
  paths. Added parameters reject collisions. Changes require review when upstream
  assumptions change; supplements are not official Plex definitions.
- `openapi/cloud.json` is a locally maintained subset, not a claimed official
  cloud OpenAPI specification. PIN behavior comes from Plex's
  [authentication documentation](https://forums.plex.tv/t/authenticating-with-plex/609370).
  Resource fields and discovery parameters are corroborated by
  [python-plexapi](https://github.com/pkkid/python-plexapi/blob/master/plexapi/myplex.py).
- `src/generated/inputs.json` fingerprints all three inputs, the generator version,
  and the generation pipeline/extension. `pnpm plex:sdk:check` regenerates both SDKs,
  their serializers, and operation builders in a temporary directory and compares
  every artifact. Nothing in `src/generated` is manually maintained.

Run `pnpm plex:sdk:update` to fetch upstream, apply reviewed corrections, regenerate,
and check reproducibility. Every run also checks package/server types,
package/server tests, and generation/enforcement tests directly in the updater,
including retries after failed validation. Failures fail the command. Unchanged
input does not change timestamps.

To add an operation, first find it in the upstream contract. If coverage is absent,
add a narrowly scoped correction or cloud definition with source evidence and a
wire-example test. Do not copy a permissive response interface into the schema.
Regenerate, use its generated types, and run `pnpm preflight`. Add a URL builder to
`generateUrlBuilders` only if a caller needs a URL before fetching: that extension
extracts the generated operation's URL, options type, and serializer configuration.
It does not maintain another endpoint table or execute a fake request.

## Exports and transport

| Export                             | Use                                                       |
| ---------------------------------- | --------------------------------------------------------- |
| `@cliparr/plex/pms`                | Generated PMS operations, including `eventsourceGetSlash` |
| `@cliparr/plex/pms/types`          | Generated parameters and responses                        |
| `@cliparr/plex/pms/urls`           | Operation-specific deferred media URL builders            |
| `@cliparr/plex/cloud`              | Generated PIN and resource operations                     |
| `@cliparr/plex/cloud/types`        | Generated cloud wire models                               |
| `@cliparr/plex/{pms,cloud}/client` | Transport-only client factories/types                     |

```ts
const preview = transcodeStartUrl({
  path: { transcodeType: "video", extension: "m3u8" },
  query: { path: metadataPath, protocol: "hls", transcodeSessionId },
});
```

Server JSON operations use `pmsClient.ts`, which enforces redirect safety and DNS
pinning. Its client factory captures the caller's original signal in the injected
fetch closure. This retains cancellation after response headers and garbage
collection of the generated `Request`. Ordinary JSON wrappers impose their own
short timeout; a streaming caller owns handshake/idle deadlines and the full stream
lifetime. Use `parseAs: "stream"` and `result.response.body`; the generated binary
`data` type does not describe the live stream. Do not use SDK SSE auto-retry alongside
a separate reconnect owner.

`mediaClient.ts` runs subtitle decisions through the existing media proxy transport.
Deferred generated media URLs become authorized media handles. Returned manifests,
segments, images, and other resource links retain existing validation, credential
stripping, range, cancellation, and cache behavior. Subtitle handles carry the
generated decision query so playback never reconstructs it by rewriting a URL.
Cloud clients are per-request; PIN requests carry no token and discovery receives
only the user token. PMS/media requests receive only the server resource token.

## Provider organization

Server policy remains in `apps/server/src/providers/plex`:

| Module            | Responsibility                                                                       |
| ----------------- | ------------------------------------------------------------------------------------ |
| `playback.ts`     | Connection failover and currently-playing orchestration                              |
| `selection.ts`    | Generated metadata projections, live track selection, preview URLs, export estimates |
| `metadata.ts`     | Batched enrichment, export tags, and origin-scoped artwork credentials               |
| `subtitles.ts`    | Delivery URL/format selection and embedded-subtitle preparation                      |
| `mediaHandles.ts` | Authorized Plex media handles and API base-path resolution                           |
| `mediaProxy.ts`   | HTTP proxy lifecycle, range handling, and cancellation                               |

Metadata is fetched once for distinct item IDs within each poll. Enrichment is
combined separately with each live session, preserving its stream selections
instead of inheriting the library's defaults. The PMS and shared media transports
use `shared/networkPolicy.ts` for address classification and redirect credential
stripping; their DNS, timeout, retry, and streaming policies remain separate.

Enrichment retains live resource keys and fills in descriptive fields from the
library. Media and part IDs take precedence over array positions; positions are
used only when an identity is missing. **Behavior change:** if an explicit live
ID conflicts with library metadata, previews and subtitle extraction are omitted
instead of selecting another version. A returned live download URL and its live
audio selection remain usable. Streams match by ID, then by source index, stream
identifier, or an unambiguous resource key when IDs are missing. **Behavior change:**
streams never match by array position; unidentified live streams retain their own
selection and descriptive fields without inheriting library identity.
Audio track numbers come only from a stream matched to the raw library part.
**Behavior change:** partial live lists and unmatched streams omit the ordinal;
the editor selects using the retained language/title instead of a guessed number.

Generated deferred operations pass `generatedOperation: true` to `createMediaHandle`
so the configured PMS base path is included once. Returned resource URLs use normal
URL resolution unchanged. Internal metadata paths in transcode queries remain
relative to PMS itself, without the reverse proxy prefix.

## Current inventory

| Caller                             | Contract or resource handling                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| Identity/session/metadata JSON     | `getIdentity`, `statusGetSlash`, `libraryMetadataGetSlash`                                    |
| Metadata reference and HLS preview | `libraryMetadataGetSlashUrl`, `transcodeStartUrl`                                             |
| HD artwork                         | `imageTranscodeUrl`; original artwork links remain resources                                  |
| Embedded subtitles                 | `transcodeDecision`, `startSelectedSubtitleUrl`                                               |
| External subtitles                 | `libraryGetStreamsStreamUrl` for recognized local stream keys; other returned links unchanged |
| Downloads                          | Returned part key, including a metadata lookup when initially absent                          |
| Auth/discovery                     | `createPin`, `getPin`, `getResources`; browser auth fragment centralized in `auth.ts`         |
| Bootstrap                          | `getIdentity`, `libraryGetSections`, `libraryPostSection`                                     |

The HLS wildcard is explicitly modeled as an extension parameter. The sidecar
subtitle route is separate from upstream `transcodeSubtitles`; the reviewed Plex
Web protocol uses a video decision followed by the sidecar operation with an
isolated session and `copyts`. Library bootstrap uses the collection route
`/library/sections`, string library type, and singular `location`; upstream's `/all`
route and parameter mismatches are corrected explicitly. Response models continue
to derive from upstream components, including Player/User/Session.

## Compatibility changes

- Downloads require a returned part key. Cliparr no longer guesses part paths from
  IDs, filenames, or unverified timestamps. A server omitting keys even in metadata
  can still offer the HLS preview but will have no direct-download source.
- Cloud completion recognizes the documented `authToken` field, not `auth_token`.
  Resource ownership/local/relay flags use the JSON boolean contract, and discovery
  no longer reads the undocumented `machineIdentifier` resource alias.
- Undocumented `Network` metadata no longer populates export network tags.
- Returned subtitle links with unsupported raw formats (such as ASS or TTML) are
  not offered for import. Recognized local stream routes can still use generated
  VTT conversion, and selected embedded subtitles use the sidecar operation.
  Raw SRT/VTT resource links are followed unchanged and labeled with their format.
- PMS redirects now share the media proxy's blocked-address policy, including
  reserved IPv4 destinations in `0.0.0.0/8` and `240.0.0.0/4`. Configured Plex
  origins retain their existing trusted-origin handling.
- Wire types no longer advertise singleton arrays, null/string/numeric aliases
  absent from the JSON schema. Tests use contract-shaped JSON fixtures. No new
  minimum PMS version is asserted.
- Development bootstrap now exits unsuccessfully on exhausted readiness/creation
  retries. Compose surfaces the failure instead of silently starting after a failed
  library bootstrap. Creation retries first re-read sections to avoid duplicates.

## Validation and downstream PR #204

The architecture check runs in lint and rejects direct/global/aliased fetch,
prohibited transport imports, client creation outside named boundaries, raw member
access through locally aliased Plex clients, handwritten wire interfaces/type
literals, and authored endpoint strings (patterns derive from contract inputs). Generated artifacts and
explicit test files are excluded; the metadata prefix exception is limited to its
returned-reference validator. This is a static guard plus code review, not a proof
against arbitrary runtime string computation.

Tests cover independent sanitized wire examples, bootstrap readiness/idempotence,
stale artifacts/supplements, real-consumer fault injection, and forced-GC streaming
cancellation. Existing media/security tests remain required. Fixtures clearly
identify documentation versus observed protocol sources; they contain no account
tokens or private media recordings.

This prerequisite targets main and imports none of #204's live feature. After it
merges, #204's owner must rebase, migrate its SSE caller to `eventsourceGetSlash`
through `createPlexPmsSdkClient`, add an evidence-backed event-envelope supplement,
and consume its generated model. Preserve one reconnect owner, coalescing, session
isolation, connection limits, and revocation/idle behavior. Run all enforcement,
preflight/build, and live tests without restoring old modules or bypasses.
