# Changelog

Published release notes are available in [GitHub Releases](https://github.com/TechSquidTV/Cliparr/releases).

## Unreleased

### Changed

- **Container maintenance:** production runs on non-root distroless Debian 13 without a shell or package manager. The Node executable moves from `/usr/local/bin/node` to `/nodejs/bin/node`; update custom maintenance commands and entrypoint overrides.

- Source installations now require a stable Node 26 version satisfying `engines.node`; use `.nvmrc` before installing dependencies. All container images include the pinned Node 26 runtime and use pinned upstream base images.

### Fixed

- New subtitles begin on the displayed video frame and show text edits immediately while paused between frames. Existing subtitles, including hidden cues, retain their timing. ([#320](https://github.com/TechSquidTV/Cliparr/issues/320))
