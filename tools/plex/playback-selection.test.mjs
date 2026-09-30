import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Run each side with its own TypeScript aliases and dependencies. The actual
// normalized provider payload crosses the same JSON boundary as the browser API.
function runPackageScript(directory, script, input = "") {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    {
      cwd: new URL(`../../apps/${directory}/`, import.meta.url),
      encoding: "utf8",
      input,
      env: { ...process.env, CLIPARR_LOG_LEVEL: "error" },
      timeout: 20_000,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

void test("Plex audio selection reaches the frontend without inventing ordinals from partial streams", () => {
  const payload = runPackageScript(
    "server",
    `
    import assert from 'node:assert/strict';
    import { listCurrentlyPlaying } from './src/providers/plex/playback.ts';
    const baseUrl = 'http://plex.local:32400';
    const source = {
      id: 'source', providerId: 'plex', providerAccountId: 'account', name: 'Fixture', enabled: true, baseUrl,
      connection: { baseUrlMode: 'manual', connections: [{ id: 'connection', uri: baseUrl, local: true, relay: false }], selectedConnectionId: 'connection' },
      credentials: { accessToken: 'synthetic' }, metadata: { owned: true, provides: ['server'] },
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    };
    const spanish = { id: 31, streamType: 2, index: 2, languageCode: 'spa', title: 'Spanish', selected: true };
    const english = { id: 30, streamType: 2, index: 1, languageCode: 'eng', title: 'English', selected: false };
    const live = { ratingKey: '42', sessionKey: 'viewer', type: 'movie', Media: [
      { id: 20, Part: [{ id: 21, key: '/returned/live.mp4', Stream: [spanish] }] },
    ] };
    const originalFetch = globalThis.fetch;
    const results = [];
    try {
      for (const scenario of ['complete-library', 'conflicting-media', 'conflicting-part', 'lookup-failed', 'missing-item', 'live-only-stream', 'no-rating-key']) {
        const session = { id: scenario, providerId: 'plex', providerAccountId: 'account', userToken: 'synthetic', mediaHandles: new Map(), createdAt: 0, expiresAt: Date.now() + 60_000 };
        const library = { ratingKey: '42', type: 'movie', Media: [{
          id: scenario === 'conflicting-media' ? 10 : 20,
          Part: [{ id: scenario === 'conflicting-part' ? 11 : 21,
            Stream: scenario === 'live-only-stream' ? [english] : [english, { ...spanish, selected: false }],
          }],
        }] };
        globalThis.fetch = async (input, init) => {
          const request = new Request(input, init);
          if (new URL(request.url).pathname === '/status/sessions') {
            return Response.json({ MediaContainer: { Metadata: [{ ...live, ratingKey: scenario === 'no-rating-key' ? undefined : '42' }] } });
          }
          assert.notEqual(scenario, 'no-rating-key');
          if (scenario === 'lookup-failed') return new Response('Unavailable', { status: 503 });
          return Response.json({ MediaContainer: { Metadata: scenario === 'missing-item' ? [] : [library] } });
        };
        const [entry] = await listCurrentlyPlaying(session, source);
        assert.ok(entry.item.mediaUrl, scenario);
        const audio = entry.item.selectedAudioTrack;
        assert.equal(audio.languageCode, 'spa', scenario);
        assert.equal(audio.trackNumber, scenario === 'complete-library' ? 2 : undefined, scenario);
        results.push({ scenario, item: entry.item });
      }
    } finally { globalThis.fetch = originalFetch; }
    process.stdout.write(JSON.stringify(results));
  `,
  );
  const results = JSON.parse(payload);
  assert.equal(results.length, 7);

  runPackageScript(
    "frontend",
    `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { editorSessionFromCurrentlyPlaying } from './src/lib/editorMedia.ts';
    import { selectPreferredPairableAudioTrack } from './src/lib/selectPreferredAudioTrack.ts';
    const results = JSON.parse(readFileSync(0, 'utf8'));
    const tracks = [
      { number: 1, getLanguageCode: async () => 'eng', getName: async () => 'English' },
      { number: 2, getLanguageCode: async () => 'spa', getName: async () => 'Spanish' },
    ];
    for (const { scenario, item } of results) {
      const session = editorSessionFromCurrentlyPlaying(item);
      const selected = await selectPreferredPairableAudioTrack(null, tracks, session.selectedAudioTrack);
      assert.equal(selected, tracks[1], scenario);
    }
  `,
    payload,
  );
});
