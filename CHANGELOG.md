# Changelog

Published release notes are available in [GitHub Releases](https://github.com/TechSquidTV/Cliparr/releases).

## Unreleased

### Changed

- Source installations now require a stable Node 26 version satisfying `engines.node`; use `.nvmrc` before installing dependencies. Production, development, and capture images include the pinned Node 26 runtime and use pinned official Debian slim base images.

### Fixed

- New subtitles begin on the displayed video frame and show text edits immediately while paused between frames. Existing subtitles, including hidden cues, retain their timing. ([#320](https://github.com/TechSquidTV/Cliparr/issues/320))
