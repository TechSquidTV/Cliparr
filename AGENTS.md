# Repository instructions

- Use strict TypeScript. Do not author `any`; reserve `unknown` for untrusted boundaries.
- Reuse existing types and helpers. Review completed changes for duplication and unnecessary layers.
- Breaking changes are acceptable when explicitly documented. Do not add compatibility aliases or fallback implementations.
- Use scoped Conventional Commits, without agent branding. Run `pnpm preflight` before every commit.

## Plex contracts

All Cliparr-authored Plex API operations, endpoint templates, parameter contracts,
and wire response models must derive from generated artifacts in `@cliparr/plex`.
Resolve missing coverage in the generation inputs before adding a caller. No
handwritten endpoint bypasses or duplicate wire models.

Use generated operations for immediate requests and generated operation-specific
URL builders for deferred media requests. Follow validated Plex-returned resource
links unchanged; do not invent HLS segment endpoints. Keep browser sign-in
navigation centralized in the auth module: it is a browser protocol, not PMS REST.

Client creation belongs in the named transport boundaries enforced by
`pnpm plex:architecture:check`. Keep transport security, credential scope, media
lifecycle, and normalized Cliparr domain models in application code. Do not edit
generated files. See [Plex contract maintenance](packages/plex/README.md).
