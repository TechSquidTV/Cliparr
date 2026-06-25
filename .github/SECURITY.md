# Security Policy

Cliparr is a local-first tool that stores encrypted provider credentials in SQLite under `CLIPARR_DATA_DIR`, keeps short-lived browser sessions and media handles, and proxies media from configured Plex/Jellyfin sources or user-provided media URLs to the browser.

Keep your `APP_KEY` stable and private. It is required to decrypt persisted provider credentials, so backups of Cliparr data should include both the data directory and the matching key.

## Reporting a Vulnerability

Please do not open a public issue for vulnerabilities.

Report security concerns by opening a private security advisory on GitHub, or by contacting the project maintainer privately if advisories are not yet enabled.

Useful details include:

- Affected version or commit
- Steps to reproduce
- Expected and actual behavior
- Any relevant logs with provider tokens, credentials, server addresses, and private media paths removed

## Supported Versions

Security fixes are provided for the latest release.
