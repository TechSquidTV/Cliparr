# Fixture privacy correction

Audit date: 2026-10-03. Base: merged main after #217 and #218.
This report identifies locations and categories without reproducing private values.
It describes the corrected tracked snapshot, not an erasure of Git history.

## Findings and disposition

| Location                                                                                                                                      | Category                                                                       | Disposition                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server/src/providers/**/*.test.ts`, `apps/server/src/session/mediaHandles.test.ts`, `tools/plex/playback-selection.test.mjs`            | Reported private endpoint (33 references across 13 files in the base snapshot) | Replaced with reserved provider domains, documentation-range DNS mocks, or explicit loopback socket fixtures.                                                                                                                                                              |
| Other server route, persistence, session, and provider tests                                                                                  | Endpoint literals of uncertain provenance, provider-derived host identifiers   | Replaced with reserved examples. LAN classifier coverage uses only labelled representative boundaries in `networkPolicyFixtures.ts`.                                                                                                                                       |
| `apps/www/src/data/product.ts`, access-control documentation                                                                                  | Unexplained VPN binding example                                                | Read the binding address from a local environment variable; no installation-specific value in source.                                                                                                                                                                      |
| Homepage/README posters and recordings, `apps/www/public/docs/*`, social preview, release/introduction blog images, conversion comparison GIF | Captured library titles, filenames, and media of uncertain provenance          | Fresh public Sintel captures; blog images reuse the shared captures. Removed superseded blog binaries.                                                                                                                                                                     |
| `packages/plex/openapi/pms.json`, `pms-supplement.json`                                                                                       | Upstream examples containing server/device identifiers and filesystem paths    | Verified the entire PMS snapshot byte-for-byte against Plex's published specification. The supplement repeats the same upstream file-path example. Exact SHA-256 exceptions in the privacy check require review when either file changes. Generated files were not edited. |
| Repository attribution, license/copyright records, project domains, public package/documentation links                                        | Intentional public attribution                                                 | Retained. Public endpoint exceptions are enumerated in the policy check.                                                                                                                                                                                                   |
| Docker development configuration                                                                                                              | Public development credentials, service names, isolated network                | Retained as documented development fixtures; no personal account required.                                                                                                                                                                                                 |

No live personal credential was confirmed during the tracked text and binary-metadata
review. This is not a guarantee about historical commits, external copies, or
values that cannot be distinguished from fabricated test data. No history rewrite
or credential revocation is included in this forward correction.

## Review follow-up

Review found two remaining non-synthetic server-name references in
`apps/server/src/db/providerPersistence.test.ts`. They now use the reserved Plex
fixture hostname. The check also covers bare hostname literals with common public
DNS suffixes, using fabricated regression data rather than the removed hostname.

Literal URL hostnames remain subject to validation when ports, paths, queries,
fragments, or credentials contain template expressions. Only hostnames that are
themselves dynamic are skipped; source code is never evaluated by the check.
Regression cases cover both rejected endpoints and permitted fixture/public hosts.

## Review method

Reviewed tracked source, configuration, docs, fixture responses, URLs, address-derived
Plex hostnames, home paths, opaque identifiers and credential-like fields. The
reported address was also checked in dotted, hyphenated, underscore, decimal,
hexadecimal, octal, mapped IPv6, URL-encoded and Base64 representations, using a
local in-memory query rather than committing it to a blacklist.

Reviewed all tracked image/video/audio assets and their metadata. Branding icons,
empty converter screenshots, and synthetic timeline benchmark screenshots contain
no observed personal installation data and were retained. The tiny PCM audio
fixture is generated. New screen captures show only the seeded public film and
fabricated capture account/device labels. Videos are silent; the capture pipeline
checks codecs, dimensions, duration and frame advancement.

## Public media provenance

Sintel (2010), copyright Blender Foundation, is available under
[CC BY 3.0](https://durian.blender.org/sharing/). The source is the repository's
`docker/seed-media.sh` download, verified against its published checksum.
The website credits it in the footer. Captures preserve its original timeline:
hero 111.95–114.89 seconds, mobile 129.6–139.6 seconds. Both use embedded English
subtitles. The GIF comparison uses the same film at 112–114 seconds, resized to
180 pixels per side, 12 fps, with a shared 32-color palette and dithered/undithered
halves. No personal media library or account was used.

## Validation

- Node 24 server tests and Plex contract tooling tests run with external networking
  denied by an OS sandbox and loopback enabled: 338 and 41 tests passed.
- Disposable instances of the existing Docker development services bootstrapped
  successfully with the seeded film and fresh volumes. Plex identity through the
  service hostname, sessions and seeded library through its bootstrap loopback
  namespace, and Jellyfin server information and development-account login passed.
- The website capture pipeline exercised Jellyfin authentication, discovery,
  playback, subtitles and both responsive editor layouts end to end.
- Node 24 `pnpm preflight`, `pnpm docs:check`, `pnpm privacy:check` and
  `pnpm build:web` passed.
- `pnpm privacy:check` runs in preflight and CI. Its tests use fabricated violations
  and verify that diagnostics contain locations/categories only. It adds no scanner
  dependency and does not replace review of credentials or binary contents.

Production API behavior and configuration defaults are unchanged. Ordinary tests
need no Docker, personal servers, or provider credentials. See the development
documentation for fixture conventions and the optional seeded integration stack.
