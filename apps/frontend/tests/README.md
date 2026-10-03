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

## Production media loading

Run `CLIPARR_TEST_BROWSER_CHANNEL=chrome pnpm --filter @cliparr/frontend test:browser:loading`.
The same CI job runs this suite separately from the audio fidelity checks. It
builds the actual frontend and a separate converter harness, generates short
synthetic AAC/AC3/EAC3 MP4s in an isolated context, and measures requests in fresh
contexts with service workers disabled. Fixture video uses VP9 so headless Chrome
can decode it in software.

A test-only build hook maps source modules to emitted chunks, including shared
chunks. Checks assert feature-loading boundaries rather than filenames or exact
byte counts: ordinary preview needs no optional codecs; selected AC3/EAC3 audio
loads its decoder; export setup loads its chosen encoder and audio helpers; GIF
encoding loads only when exporting. A suspended helper request exercises closing
the dialog and replacing its source before loading finishes. Direct converter
exports verify that GIF/video-only output never initializes audio extensions.

CI retains `build/browser-export/loading/chunks.json` and `requests.json`, with
per-stage requested files, features, and gzip sizes. Failures also retain a log
and screenshot. To add a heavy optional dependency, declare its module fragment
in the runner and extend the relevant scenario with the earliest allowed loading
stage. Keep fixture generation out of measured contexts. Static import boundaries
are enforced by the existing frontend ESLint configuration; type imports and test
fixtures are exempt.

Follow-up: the timeline adapter currently imports Mediabunny's full module,
including output/muxer code during preview. A narrower upstream adapter contract
is needed to improve that boundary without patching dependencies or using private
entrypoints. Motion feature loading is a separate UI change requiring visual and
interaction checks. Neither is treated as an optional codec in this suite.
