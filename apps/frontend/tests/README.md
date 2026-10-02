# Audio export browser checks

Install Chrome with `pnpm --filter @cliparr/frontend exec playwright install --with-deps chrome`,
then run `CLIPARR_TEST_BROWSER_CHANNEL=chrome pnpm --filter @cliparr/frontend test:browser`.
CI uses the same Chrome channel so AAC decoding is available.

The runner builds a temporary production bundle, serves it locally, checks the
five audio formats in a real browser, and removes its temporary output. Fixtures
use synthetic PCM and MediaBunny encoding; no external media tools are required.
The checks cover mono playback, center-channel dialogue, supported AAC channel
preservation, low-rate MP3 bitrate, metadata, WebP-to-PNG artwork embedding,
lossless sample preparation after
browser decoding, FLAC rejection feedback and independent playback, 7.1 AAC
stereo mixdown, MP3 cancellation and retry, and encoder-worker cleanup.
Focused `exportClip.integration.test.ts` checks cover Cliparr trimming and source
precision through the real export entry point. The fixed 32-bit input lives in
`src/lib/fixtures`; fixture details are documented there. Codec implementations
and container layout are delegated to MediaBunny.

Node tests remain part of repository preflight. The browser suite runs in the
**Browser audio export** CI job on pull requests and main. Failures retain logs
and a screenshot under `build/browser-export` (uploaded by CI).

Provider-style tests serve generated media over local HTTP: a native FLAC with
an unreadable tail, FLAC audio inside MP4/MKV, and AAC HLS with multiple fMP4
segments and a nonzero timeline origin. They verify source-range protection,
valid-prefix retry, container-specific checks, and clip timing across segments.
The independent upstream reproduction is in [flac-upstream-reproduction.md](flac-upstream-reproduction.md).
No provider credentials or external media tools are needed.
