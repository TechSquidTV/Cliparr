---
name: cliparr-www-assets
description: Refresh Cliparr marketing captures or maintain their Playwright/Jellyfin/FFmpeg pipeline, preserving approved sources, scene settings, review gates, and targeted writes.
---

# Cliparr Marketing Captures

Use `pnpm assets:capture`: real Jellyfin playback through Cliparr's media adapter, controlled by Playwright's capture bridge, not desktop recording.

## Scope and sources

- Replace tracked captures only for a requested asset refresh. Code changes, tests, privacy audits, and documentation cleanup do not authorize replacement. Report concrete privacy findings; a visible media title/filename alone is not evidence of private information.
- Preserve user-selected media/scenes; never substitute Sintel, development seeds, or other scenes without a request. Approved defaults: hero/stills **Common Side Effects — S01E01, Pilot**; mobile **The Twilight Zone — S01E08, Time Enough at Last**.
- Run without `--write`, inspect `review.html` and `report.json`, then repeat with `--write` only for the requested, visually reviewed target. An explicit restoration request may restore tracked captures directly from Git history.
- Hero poster + MP4 + WebM form one refresh unit; so do mobile's three assets. Each poster comes from its delivered MP4's first frame. README/social are an independent pair: changing them never authorizes changes to hero/mobile assets.

Full capture needs both selected sources. Use `--target mobile` with only the mobile source and subtitles, or `--target readme-social` with only hero and subtitles. Mount only the required sources/subtitles in a dedicated directory (recursively indexed), not a personal library. Sources are read-only and must retain original timelines through the out point; never pre-trim.

Prefer existing non-empty, language-tagged Jellyfin sidecars, e.g. `<media>.en.srt`. Transcribe only if the required sidecar is absent; capture-window-only SRTs must retain original timestamps. The disposable Jellyfin session prefers English text subtitles, otherwise the first supported text track. Image-only subtitles do not qualify.

## Scenes

Canonical configuration: `tools/www-assets/src/scenes.ts`.

| Scene  | Cliparr in/out  | Selection | CSS viewport → capture | Caption size     | Recording duration |
| ------ | --------------- | --------- | ---------------------- | ---------------- | ------------------ |
| Hero   | 8:16.07–8:19.01 | 2.94 s    | 1600×886               | 72 px            | 82/30 s (~2.733)   |
| Mobile | 23:22–23:32     | 10 s      | 402×874 → 1206×2622    | 150 px (maximum) | 3 s                |

Hero fractional timecodes are decimal seconds, not frame numbers. Recording starts at the in point; its length is independent of selection duration. `--hero-seconds` / `--mobile-seconds` override recording only, must be positive, and must fit the selection. `--hero-subtitle` / `--mobile-subtitle` accept Cliparr track keys; failures list available keys.

README/social: paused, decoded, subtitle-visible frame at **8:16.72** (in + 0.65 s), 72 px captions, independent **1600×840** viewport. One lossless PNG produces **1600×840 WebP** and **1200×630 JPEG**, without cropping/padding. Never resize hero video capture for this still or silently omit its active subtitle.

## Run and capture mechanics

Requires the Node version in `.nvmrc`, pinned pnpm, Docker Compose, and `pnpm install --frozen-lockfile`. The image supplies pinned Playwright/browser and FFmpeg; host ImageMagick is unnecessary.

```bash
pnpm assets:capture --media-dir /absolute/path/to/media \
  --hero 'hero.mkv' --mobile 'mobile.mkv'
```

Source arguments are relative to `--media-dir`, allow subdirectories, and default to `hero.mkv` / `mobile.mkv`. Default `--target all` captures hero/mobile, README/social, and documentation screenshots (export dialog, subtitle panel, crop guide). For the still pair only, add `--target readme-social`, omit mobile, and mount only hero/subtitles; this skips videos, mobile setup, and documentation captures. `--write` replaces only the selected target's outputs. Preserve required media attribution; blog images reuse homepage captures.

The pipeline builds production-mode Cliparr with the bridge, bootstraps disposable Jellyfin with remote metadata disabled, registers playback via its API, and records sequentially. Unique project volumes, no host ports, and the recorder sharing Cliparr's loopback network namespace allow concurrent development and secure-context WebCodecs.

- Use `window.cliparrAssetCapture` for selection, seeking, timeline fit, readiness, playback/pause. It wraps existing hooks and `TimelineEngine.setInOutRange`; no engine-only playback bypass or fake editor.
- Bridge flag `VITE_CLIPARR_ASSET_CAPTURE=true` is capture-only: never deploy it; verify normal bundles exclude it.
- Keep the CSS viewport fixed. Use device scale 3 for mobile and 1 for hero and stills. Set screencast and encoded dimensions to viewport × device scale. Apply configured caption sizes through the bridge; subtitles must be enabled, loaded, and overlap the selection.
- Await metadata, decoded starting frame, subtitle cues, fonts, and layout. Explicit Playwright screencast + programmatic playback; trim pre-play lead-in using captured frame timestamps. Exclude login/loading/setup, cursors, pointer annotations, and overlays.
- After fitting selection, zoom to 65% of fitted scale, centered on the viewport, to show surrounding media/boundaries.
- No screenshot tracing or context-level video alongside the final screencast: they can override frame size. Mobile is responsive-browser capture, not evidence of native PWA behavior.

## Outputs and review

Runs retain gitignored `.asset-capture/run-*/review.html`, `report.json`, and diagnostics. Videos/posters live under `apps/www/src/assets/`:

| Scene  | Poster                    | Videos                                              |
| ------ | ------------------------- | --------------------------------------------------- |
| Hero   | `screenshot.webp`         | `preview.mp4`, `preview.webm`                       |
| Mobile | `mobile-pwa-preview.webp` | `mobile-pwa-preview.mp4`, `mobile-pwa-preview.webm` |

README/social outputs: `.github/img/screenshot.webp` and `apps/www/public/og.jpg`. Review source `readme-social.png` is lossless; `readme.webp` is independent of hero's first-frame `screenshot.webp`. Check both images, shared timestamp, dimensions, and sizes in the review/report.

Encoding: silent H.264 MP4 (fast-start) / VP9 WebM, 30 fps; WebP posters extracted from delivered MP4 first frames. FFprobe/full decode validate dimensions, codecs, absent audio, and duration; telemetry verifies decoded frame advancement/rejects stalls. Keep homepage imports in `src/assets` for Astro content-hashed URLs; stable `public` video URLs risk stale poster/video pairings.

500 KB hero / 100 KB mobile video budgets are advisory; inspect reported overages/quality before adjusting encoding. Never silently reduce resolution or make UI unreadable to meet size targets.

- After asset writes: `pnpm build:web`. Still-only: verify matching subtitle-visible frames and social metadata `image/jpeg`, 1200×630. Video refresh: preview with `pnpm dev:web`; check poster alignment, hover playback, looping, reduced-motion static behavior, and matching `Picture` dimensions in `apps/www/src/pages/index.astro`.
- Pipeline changes: `pnpm test:assets`, relevant package type/lint checks, `pnpm --filter @cliparr/frontend test` for bridge edits. Exercise full, mobile-only, and still-only modes end to end without writes. Seeds may validate the pipeline but cannot replace marketing assets unless selected for that refresh; separately report whether supplied-media visual review is complete.
- Diagnose via `*-failure.png`, `*-failure.json`, `*-playback.json`, `containers.log`. Missing/short sources are input errors: never alter requested in/out points to pass. Missing subtitles need supported embedded text/sidecars; decoder failures belong in Cliparr source/codec handling. Run-owned Docker resources are cleaned on completion/failure; review files remain.
