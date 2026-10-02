# Audio export browser checks

Run `pnpm --filter @cliparr/frontend test:browser` after installing Playwright's
Chromium (`pnpm --filter @cliparr/frontend exec playwright install chromium`).
To use an installed Chrome instead, set `CLIPARR_TEST_BROWSER_CHANNEL=chrome`.

The runner builds a temporary production bundle, serves it locally, checks the
five audio formats in a real browser, and removes its temporary output. Fixtures
use synthetic PCM and MediaBunny encoding; no external media tools are required.
The checks cover mono playback, center-channel dialogue, supported AAC channel
preservation, low-rate MP3 bitrate, metadata, lossless sample preparation after
browser decoding, FLAC rejection feedback and independent playback, 7.1 AAC
stereo mixdown, MP3 cancellation and retry, and encoder-worker cleanup.
Focused `exportClip.integration.test.ts` checks cover Cliparr trimming and source
precision through the real export entry point. The fixed 32-bit input lives in
`src/lib/fixtures`; fixture details are documented there. Codec implementations
and container layout are delegated to MediaBunny.

Node tests remain part of repository preflight;
run this browser suite separately for export or encoder dependency changes.
