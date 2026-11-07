# Changelog

Published release notes are available in [GitHub Releases](https://github.com/TechSquidTV/Cliparr/releases).

## Unreleased

### Changed

- Source installations on Node 24 must upgrade to the version in `.nvmrc` or a newer compatible stable Node 26 release. The production Docker image includes the runtime and runs as a non-root user on distroless Debian 13. ([#321](https://github.com/TechSquidTV/Cliparr/pull/321))

### Fixed

- New subtitles begin on the displayed video frame and show text edits immediately while paused between frames. Existing subtitles, including hidden cues, retain their timing. ([#320](https://github.com/TechSquidTV/Cliparr/issues/320))
