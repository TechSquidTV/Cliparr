# Changelog

Published release notes are available in [GitHub Releases](https://github.com/TechSquidTV/Cliparr/releases).

## Unreleased

### Added

- Clip export opens full screen on mobile and keeps the estimated file size and Export button in view. Back returns to the same clip and playhead, and Forward reopens your settings. Leaving during an export asks for confirmation. On desktop, the size estimate appears beside Export. Mute and stereo mixdown are grouped under Audio on both layouts.

### Changed

- Source installations now require a stable Node 26 version satisfying `engines.node`; use `.nvmrc` before installing dependencies. Production, development, and capture images include the pinned Node 26 runtime and use pinned official Debian slim base images.

### Fixed

- New subtitles begin on the displayed video frame and show text edits immediately while paused between frames. Existing subtitles, including hidden cues, retain their timing. ([#320](https://github.com/TechSquidTV/Cliparr/issues/320))
