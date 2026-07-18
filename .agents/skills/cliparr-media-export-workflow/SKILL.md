---
name: cliparr-media-export-workflow
description: Cliparr media editor/export workflow guidance for HLS playback, source selection, Mediabunny export, timeline normalization, subtitle burn-in, metadata tagging, media proxy behavior, and memory-sensitive export changes. Use when an agent changes or reviews files under apps/frontend/src/components/editor, apps/frontend/src/lib media/export helpers, apps/server media proxy/provider playback paths, or shared provider playback contracts.
---

# Cliparr Media Export Workflow

## Overview

Use this skill for changes that affect Cliparr's editor preview, HLS handling, export source choice, Mediabunny conversion, subtitle burn-in, metadata tagging, timeline offsets, or media proxy behavior.

Treat the implementation and its focused tests as the canonical reference for
media editor and export behavior. When behavior changes, update the matching
tests in the same change instead of maintaining a parallel architecture
diagram.

## Main Entry Points

Frontend editor and playback:

- `apps/frontend/src/components/editor/useEditorTimelineMedia.ts`
- `apps/frontend/src/components/editor/editorPlaybackSources.ts`
- `apps/frontend/src/components/editor/editorTimelineEngine.ts`
- `apps/frontend/src/components/editor/EditorTimeline.tsx`

Export and media helpers:

- `apps/frontend/src/components/editor/useEditorExport.ts`
- `apps/frontend/src/components/editor/EditorExportDialog*.tsx`
- `apps/frontend/src/lib/exportClip.ts`
- `apps/frontend/src/lib/exportMetadata.ts`
- `apps/frontend/src/lib/exportFileName.ts`
- `apps/frontend/src/lib/mediabunnyInput.ts`
- `apps/frontend/src/lib/mediabunnyTrackAccess.ts`
- `apps/frontend/src/lib/editorMedia.ts`
- `apps/frontend/src/lib/localMediaRegistry.ts`

Subtitles and track selection:

- `apps/frontend/src/lib/selectPreferredAudioTrack.ts`
- `apps/frontend/src/lib/selectPreferredSubtitleTrack.ts`
- `apps/frontend/src/lib/subtitles/*`
- `apps/frontend/src/components/editor/useEditorSubtitles.ts`
- `apps/frontend/src/components/editor/useSubtitleCues.ts`

Server/provider paths:

- `apps/server/src/providers/shared/mediaProxy.ts`
- `apps/server/src/routes/media.ts`
- `apps/server/src/providers/plex/playback.ts`
- `apps/server/src/providers/jellyfin/playback.ts`
- `packages/shared/src/providers.ts`

## Invariants

- Keep source semantics separate from preview mechanics: source tracks determine duration, timeline offsets, export blocking, and export alignment; preview tracks determine browser playback.
- Preserve auto export source order: explicit user choice wins, otherwise fallback source, then HLS, then direct.
- Preview-only failures should not silently change the export source.
- Apply `timelineOffsetSeconds` consistently to preview seeking and export trim boundaries.
- Keep HLS playlist rewrite behavior origin-safe and base-path aware for nested relative playlists.
- Attach provider auth only when the media request origin matches the provider base URL origin.
- Avoid reopening a finished export blob for validation; `Conversion.init` should validate the output plan before execution to reduce memory pressure.
- Burn subtitles only when text cues, selected track support, style settings, and a video track are available.

## Testing

Run the package-level tests that match the change:

- Frontend editor/export changes: `pnpm --filter @cliparr/frontend test`
- Server media proxy or provider playback changes: `pnpm --filter @cliparr/server test`
- Shared provider contract changes: run both frontend and server tests.

Before committing, use `$cliparr-git-workflow`; it requires `pnpm preflight`.
