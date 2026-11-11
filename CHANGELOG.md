# Changelog

Published release notes are available in [GitHub Releases](https://github.com/TechSquidTV/Cliparr/releases).

## v3.1.1 (planned)

- Server logs redact provider login credentials. If you shared older logs, see the [security and upgrade notes](tools/release/notes/v3.1.1.md#security).
- GIF exports preserve playback timing across frames and at the end of a trim. Plex and Jellyfin allow longer for embedded subtitle extraction and explain which tracks can be imported.
- Provider sign-in handles slow responses and cancellation. The editor reuses HLS metadata for export estimates and reduces work when saving drafts, adding subtitles, and exporting GIFs.
- **Docker maintenance change.** The production image uses distroless Debian 13. Custom commands that rely on a shell, a package manager, or the old Node path need updating. [Docker upgrade instructions](tools/release/notes/v3.1.1.md#docker-upgrade)

## v3.1.0

### Added

- Clip export opens full screen on mobile and keeps the estimated file size and Export button in view. Back returns to the same clip and playhead, and Forward reopens your settings. Leaving during an export asks for confirmation. On desktop, the size estimate appears beside Export. Mute and stereo mixdown are grouped under Audio on both layouts.

### Changed

- Source installations now require a stable Node 26 version satisfying `engines.node`; use `.nvmrc` before installing dependencies. Production, development, and capture images include the pinned Node 26 runtime and use pinned official Debian slim base images.

### Fixed

- New subtitles begin on the displayed video frame and show text edits immediately while paused between frames. Existing subtitles, including hidden cues, retain their timing. ([#320](https://github.com/TechSquidTV/Cliparr/issues/320))
