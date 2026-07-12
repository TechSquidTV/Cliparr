# Canvas Timeline adapter follow-up

Cliparr editor v2 integrates the published Canvas Timeline 0.1.x packages
without changing or publishing the upstream repository. The integration uses
the lower-level `useMediabunnyAdapter` hook with `useTimelineMediaSync` because
the following gaps need upstream treatment in a second pass.

## Transport and range behavior

- `useMediabunnyTimelineMedia().play()` awaits `AudioContext.resume()`. In the
  in-app Chromium runtime the promise remained pending even though video decode
  and paused frame seeking were ready, so playback never reached
  `startClock()`. Cliparr starts the resume attempt without blocking the media
  clock. The high-level hook should bound or avoid this await and report audio
  resume degradation separately from video transport failure.
- External-clock playback does not enforce engine in/out points. The external
  media tick calls `engine.setTime()` directly and starts the engine with only
  `{ clock: "external" }`; the internal playback manager's `respectInOut`
  handling is therefore bypassed. Cliparr pauses at `outPoint` and resets to
  `inPoint` from a playhead subscription. The media-sync hook should accept and
  enforce the same playback range options as engine playback.

## Sources, tracks, and fallback

- The adapter supports `createInput`, which is sufficient for HLS inputs using
  `HLS_FORMATS`, bounded URL caching, and parallel requests. Its plain URL
  descriptor always uses `ALL_FORMATS` and default `UrlSource` options, so it is
  not an adequate HLS integration by itself.
- Cliparr gives ordered HLS and direct descriptors the same logical `sourceId`.
  The adapter's sequential loader naturally tries direct media if HLS fails
  during initial input/track/sink loading, but it exposes neither the selected
  descriptor nor individual attempt failures. Add first-class source variants
  and selected-variant diagnostics instead of requiring callback inference.
- A controller cannot switch to a fallback variant after a runtime decode or
  iterator failure. Expose a source replacement/retry operation or support
  ordered variants throughout controller lifetime.
- The adapter only asks an input for its primary video and audio tracks. Cliparr
  currently overrides those input methods after applying its alternate-video
  and selected-audio rules. Add typed video/audio track selectors or resolver
  callbacks to adapter options.

## Timeline metadata

- The adapter computes the first source timestamp internally but exposes only
  duration. Cliparr must independently discover the source timeline offset and
  assign it to the engine media clip's `sourceStart` so live/epoch media seeks
  correctly. Expose source timing metadata such as `firstTimestamp`,
  `endTimestamp`, duration, dimensions, and detected frame rate per source.
- Runtime volume and mute controls are not exposed. Cliparr supplies a stable
  master `GainNode` as the adapter destination. Add `setVolume`/`setMuted`
  controls without forcing adapter disposal and source reload.
- The adapter closes an `AudioContext` supplied by the caller. Track context
  ownership and close only contexts created by the adapter; multiple
  controllers may otherwise close the same external context.
- A new `AudioContext` is created even for video-only media. Avoid creating or
  resuming an audio graph unless a decodable audio track is present.

## Deferred preview features

- The old HLS selection warmup and `Preview Ready` range have no adapter
  equivalent and were removed in v2. A future readiness API would need decoded
  video/audio coverage ranges rather than a single boolean.
- Subtitle canvas composition and audio-only poster rendering are not adapter
  features. Cliparr stores parsed SRT/VTT cues as editable Canvas Timeline
  clips, renders a separate subtitle preview/framegrab overlay, and retains
  subtitle export burn-in without changing the adapter.
- Free-placement insertion is not exposed for overlapping subtitle cues. Cliparr
  therefore edits and deletes imported cues now, while adding new cues remains
  deferred until core supports non-ripple, non-overwrite placement.
