import assert from "node:assert/strict";
import test from "node:test";
import { parseAudioTranscript } from "@/lib/audioTranscript";

void test("SRT transcript preserves timing and readable multiline text", async () => {
  const cues = await parseAudioTranscript(`\uFEFF2\r
00:00:04,250 --> 00:00:06,000\r
<b>Cliparr</b> &amp; Plex\r
Jellyfin\r
\r
1\r
00:00:01,000 --> 00:00:02,500\r
Pick of the week\r
\r
3\r
00:00:07,000 --> 00:00:06,000\r
Invalid timing\r
`);

  assert.deepEqual(
    cues.map(({ startTime, endTime, text }) => ({ startTime, endTime, text })),
    [
      { startTime: 1, endTime: 2.5, text: "Pick of the week" },
      { startTime: 4.25, endTime: 6, text: "Cliparr & Plex\nJellyfin" },
    ],
  );
});

void test("WebVTT transcript ignores notes and retains cue identifiers", async () => {
  const cues = await parseAudioTranscript(`WEBVTT

NOTE Editorial note

intro
00:28.040 --> 00:35.920 align:start
Cliparr is a media clipper.
`);

  assert.deepEqual(cues, [
    {
      id: "intro",
      startTime: 28.04,
      endTime: 35.92,
      text: "Cliparr is a media clipper.",
    },
  ]);
});

void test("empty and unusable transcripts have no disclosure cues", async () => {
  for (const raw of [
    "",
    "\uFEFF\r\n ",
    "No timestamps here",
    "WEBVTT\n\nNOTE Only a note",
  ]) {
    assert.deepEqual(await parseAudioTranscript(raw), []);
  }
});

void test("caption markup becomes decoded plain text", async () => {
  const cues = await parseAudioTranscript(`WEBVTT

00:00.000 --> 00:02.000
<v Speaker><b>Cliparr</b> &amp; <i>Plex</i></v>
&lt;Jellyfin&gt; &quot;pick&quot; &#39;clipper&#39;
`);

  assert.equal(cues[0]?.text, "Cliparr & Plex\n<Jellyfin> \"pick\" 'clipper'");
});

void test("invalid intervals and empty captions are excluded without losing valid cues", async () => {
  const cues = await parseAudioTranscript(`1
00:00:02,000 --> 00:00:02,000
Zero duration

2
00:00:04,000 --> 00:00:03,000
Reversed

3
not-a-time --> 00:00:06,000
Malformed

4
00:00:06,000 --> 00:00:07,000
<b> </b>

5
00:00:08,000 --> 00:00:09,000
Keep this caption
`);

  assert.deepEqual(
    cues.map(({ startTime, endTime, text }) => ({ startTime, endTime, text })),
    [{ startTime: 8, endTime: 9, text: "Keep this caption" }],
  );
});
