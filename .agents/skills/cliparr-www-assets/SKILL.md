---
name: cliparr-www-assets
description: Automatically capture Cliparr's homepage hero and mobile editor videos and matching posters with Playwright, a disposable Jellyfin instance, and FFmpeg. Use when refreshing apps/www marketing previews or maintaining their capture workflow.
---

# Cliparr Website Asset Capture

Use the repository capture pipeline rather than manually recording the desktop.
The source media plays through Jellyfin and Cliparr's real media adapter. Playwright
controls the editor through its capture-only bridge; no mouse interaction is needed.

## Inputs and scene configuration

Expect **two original media assets**, one for the hero and one for the mobile
workspace. Both must retain their original timelines through the out point. Do not
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

When `--write` is enabled, the hero poster is also copied to `./.github/img/screenshot.webp`.
The README screenshot points at the homepage hero poster, so it updates automatically when captures complete.

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

After replacing assets, run `pnpm build:web`, preview the homepage with
`pnpm dev:web`, and check poster/video alignment, hover playback, looping, and
reduced-motion static behavior. Keep the Picture dimensions in
`apps/www/src/pages/index.astro` consistent with the source assets.

For pipeline changes, run `pnpm test:assets`, relevant package type/lint checks,
and `pnpm --filter @cliparr/frontend test` when editing the capture bridge. Exercise
both scenes end to end. Synthetic media can validate the pipeline before supplied
assets arrive, but must never replace the marketing assets. Report separately
whether supplied-media visual review has been completed.

## Troubleshooting

Inspect `*-failure.png`, `*-failure.json`, `*-playback.json`, and `containers.log` in the run directory.
Missing media or an insufficient source duration is a source-input error; do not
change the requested in/out points to make it pass. Missing subtitles require a
supported embedded track or sidecar. Decoder failures should be diagnosed through
Cliparr's source/codec handling. Docker resources owned by the run are removed on
completion or failure; review files are retained.
