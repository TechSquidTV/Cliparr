---
name: cliparr-www-assets
description: Capture Cliparr's homepage hero and mobile videos with matching first-frame posters, plus independent README/Open Graph stills. Use when refreshing these marketing assets or maintaining their Playwright, Jellyfin, and FFmpeg capture workflow.
---

# Cliparr Website Asset Capture

Use the repository capture pipeline rather than manually recording the desktop.
The source media plays through Jellyfin and Cliparr's real media adapter. Playwright
controls the editor through its capture-only bridge; no mouse interaction is needed.

## Refresh scope

Replace tracked README and website marketing captures only when the user requests
an asset refresh, using this pipeline. A code change, test run, privacy audit, or
documentation cleanup does not authorize replacing those assets. Report concrete
privacy findings without treating a visible media title or filename alone as
evidence of private information.

Use the user's selected source media and scene. Do not substitute Sintel, another
development seed, or a different scene unless the user requests that substitution.
Run without `--write` first and inspect `review.html` and `report.json`; use
`--write` only for the requested refresh after visual review. Keep the homepage
hero poster and both hero videos together: the poster must
come from the delivered MP4's first frame and match playback at 1600×886.
The README screenshot is an independent still, not the homepage poster. Its
Open Graph JPEG is a resized copy of the same captured frame. Refresh this pair
with `--target readme-social`; changing its framing or timestamp does not
authorize changing the homepage poster, videos, or mobile assets.
Keep the mobile poster and both mobile videos together as well. The approved
mobile source is **The Twilight Zone — S01E08, Time Enough at Last**, at
23:22–23:32. Preserve that source and scene unless the user selects a replacement.
An explicit request to restore previous tracked captures may restore them directly
from Git history instead of generating a replacement.

## Inputs and scene configuration

Full capture expects **two user-selected media assets**, one for the hero and one
for the mobile workspace. `--target readme-social` requires only the hero source.
The approved hero/still source is **Common Side Effects — S01E01, Pilot**. Preserve
that source unless the user selects a replacement. Mount only those sources and
their subtitles in a dedicated directory,
rather than indexing an entire personal library. Both sources must retain their
original timelines through the out point. Do not
pre-trim the sources to the selected clips. Prefer an existing non-empty,
language-tagged Jellyfin sidecar beside each source, such as `<media>.en.srt`.
Only transcribe when the required sidecar is missing; capture-window-only SRTs are
valid as long as their cues retain the original media timestamps. The disposable
Jellyfin session prefers English text subtitles and falls back to the first
supported text track only when no English track is available.

The canonical configuration is `tools/www-assets/src/scenes.ts`:

| Scene  | Cliparr in/out  | Selected duration | Browser/video size | Caption size | Default recording duration |
| ------ | --------------- | ----------------- | ------------------ | ------------ | -------------------------- |
| Hero   | 8:16.07–8:19.01 | 2.94 seconds      | 1600×886           | 72 px        | 82/30 seconds (~2.733)     |
| Mobile | 23:22–23:32     | 10 seconds        | 402×874            | 150 px       | 3 seconds                  |

README/social stills use the hero selection and 72 px subtitles at **8:16.72**
(0.65 seconds after the in point), with an independent **1600×840** browser
viewport. One lossless PNG produces the **1600×840 README WebP** and
**1200×630 Open Graph JPEG**, without cropping or padding. Wait for the paused,
decoded target frame and an active subtitle cue; do not silently capture without
the visible subtitle. This viewport must never resize the hero video capture.

The fractional hero timecodes are **decimal seconds, not frame numbers**.
Cliparr selection and website recording length are separate settings. Never infer
output length from the selected clip duration. Recording begins at the in point;
its duration can be overridden without changing the selection.

## Run

Requires Node 24+, the repository's pinned pnpm, and Docker with Compose. The image
installs the pinned Playwright browser and FFmpeg; no host ImageMagick is needed.
Install workspace dependencies with `pnpm install --frozen-lockfile` first.

```bash
pnpm assets:capture --media-dir /absolute/path/to/media \
  --hero 'hero.mkv' --mobile 'mobile.mkv'
```

Paths for `--hero` and `--mobile` are relative to `--media-dir` and may include
subdirectories. Defaults are `hero.mkv` and `mobile.mkv`. Mount a directory dedicated
to these two assets; the capture library indexes that directory recursively.

The command builds a production-mode Cliparr with the capture bridge enabled,
starts a disposable Jellyfin library, registers playback through Jellyfin's API,
and records each scene sequentially. It uses unique project volumes and no host
ports, so it can run alongside development services. The recorder shares Cliparr's
network namespace and uses loopback, which keeps WebCodecs available in a secure
browser context. Sources are read-only.
The existing Jellyfin bootstrap script is reused with remote metadata disabled.

Recordings and review artifacts go into a new gitignored `.asset-capture/run-*`
directory. Open its `review.html` and inspect `report.json`. To regenerate and
replace the website's six assets after both captures validate, add `--write`:

```bash
pnpm assets:capture --media-dir /absolute/path/to/media \
  --hero 'hero.mkv' --mobile 'mobile.mkv' --write
```

The default `--target all` also captures the independent README/social pair and
documentation export dialog and subtitle panel. `--write` publishes the outputs
selected by `--target`; the README points at `./.github/img/screenshot.webp`.
Blog images reuse the homepage captures. Preserve attribution required by the
selected media.

For a README/social refresh, run the following without `--write` first. This
skips video recording, mobile setup, and documentation screenshots:

```bash
pnpm assets:capture --target readme-social --media-dir /absolute/path/to/media \
  --hero 'hero.mkv'
```

Review both images in `review.html` and their source timestamp, dimensions, and
sizes in `report.json`. Then repeat with `--write` to replace only the README
WebP and `apps/www/public/og.jpg`. The hero and mobile posters and videos must
remain unchanged. Mount only the approved hero source and subtitles for this mode.

Optional `--hero-seconds` and `--mobile-seconds` control recording duration only.
They must be positive and fit within the selected range. `--hero-subtitle` and
`--mobile-subtitle` accept Cliparr subtitle track keys to override its preferred
supported text track. Failure diagnostics include the available track keys.

## Capture invariants

- Preserve the exact browser and output dimensions above; use device scale 1.
- Subtitles must be enabled, loaded, and overlap the selected range. Do not silently
  capture without them. Image-only subtitles are not a substitute for supported
  text subtitles.
- Apply each scene's configured caption size through the capture bridge before
  recording. Keep hero at 72 px and mobile at Cliparr's 150 px maximum.
- Do not show a mouse cursor, pointer annotations, or Playwright overlays.
- Use `window.cliparrAssetCapture` to configure selection, seek, fit the timeline,
  inspect readiness, and start/pause playback. It wraps existing Cliparr hooks and
  `TimelineEngine.setInOutRange`; do not bypass the media adapter with engine-only
  playback or introduce a separate fake editor.
- The bridge exists only when built with `VITE_CLIPARR_ASSET_CAPTURE=true`. Never
  enable this flag for a deployed application. Verify normal bundles exclude it.
- Wait for metadata, the decoded starting frame, subtitle cues, fonts, and layout.
  Start Playwright's explicit screencast and trigger playback programmatically;
  trim the pre-play lead-in using captured frame timestamps. Do not record login,
  loading screens, or setup interactions.
- After fitting the selection, zoom to 65% of the fitted scale, centered on the
  viewport, so surrounding source media makes the selected clip boundaries clear.
- Do not run tracing with screenshots or context-level video alongside the final
  screencast: they can override its frame size.
- Mobile is a responsive browser viewport capture, not proof of native PWA behavior.

## Outputs and verification

| Scene  | Poster                                        | Videos                                                                  |
| ------ | --------------------------------------------- | ----------------------------------------------------------------------- |
| Hero   | `apps/www/src/assets/screenshot.webp`         | `apps/www/src/assets/preview.mp4`, `preview.webm`                       |
| Mobile | `apps/www/src/assets/mobile-pwa-preview.webp` | `apps/www/src/assets/mobile-pwa-preview.mp4`, `mobile-pwa-preview.webm` |

The independent still outputs are `.github/img/screenshot.webp` (1600×840)
and `apps/www/public/og.jpg` (1200×630). The review output `readme-social.png`
is their lossless source; `readme.webp` must not be confused with the hero's
first-frame `screenshot.webp`. The report records both still dimensions, sizes,
and their shared source timestamp.

The pipeline encodes silent H.264 MP4 and VP9 WebM at 30 fps, with fast-start MP4.
It extracts each WebP poster from the delivered MP4's first frame. FFprobe and a
full decode validate dimensions, codecs, absent audio, and recording duration.
Playback telemetry verifies decoded frame advancement and rejects capture stalls.
The homepage imports posters and videos from `apps/www/src/assets` so Astro gives
every file a content-hashed deployment URL. Do not move preview videos back to
stable `public` URLs; stale browser or CDN caches can otherwise pair a new poster
with a video from an older capture.

The existing 500 KB hero / 100 KB mobile video budgets are advisory. The report
flags larger files; inspect quality before changing encoding settings. Do not
silently lower resolution or compress unreadable UI to meet a byte target.

After replacing assets, run `pnpm build:web`. For README/social-only changes,
verify the pair shows the same subtitle-visible frame and that social metadata
declares image/jpeg, 1200×630. For video refreshes, preview the homepage with
`pnpm dev:web`, and check poster/video alignment, hover playback, looping, and
reduced-motion static behavior. Keep the Picture dimensions in
`apps/www/src/pages/index.astro` consistent with the source assets.

For pipeline changes, run `pnpm test:assets`, relevant package type/lint checks,
and `pnpm --filter @cliparr/frontend test` when editing the capture bridge. Exercise
both full and README/social-only modes end to end without writes first. Synthetic or development-seed media can validate the
pipeline before supplied assets arrive, but must not replace the marketing assets
unless the user selected that media for the refresh. Report separately
whether supplied-media visual review has been completed.

## Troubleshooting

Inspect `*-failure.png`, `*-failure.json`, `*-playback.json`, and `containers.log` in the run directory.
Missing media or an insufficient source duration is a source-input error; do not
change the requested in/out points to make it pass. Missing subtitles require a
supported embedded track or sidecar. Decoder failures should be diagnosed through
Cliparr's source/codec handling. Docker resources owned by the run are removed on
completion or failure; review files are retained.
