import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  EncodedPacketSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  FlacOutputFormat,
  Input,
  Output,
} from "mediabunny";
import { exportClip, type ExportClipOptions } from "#/lib/exportClip";
import { ensureAudioEncoder } from "#/lib/mediabunnyCodecs";
import { createPcmWav } from "#/lib/exportAudioFixtures.test-support";
import { inspectAudioTrack } from "#/lib/exportAudio";
import type { AudioExportFormat } from "#/lib/exportFormats";

function check(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function convert(
  file: File,
  format: AudioExportFormat,
  mixDownToStereo = true,
  startTime = 0.125,
  endTime = 0.75,
  lifecycle: Pick<ExportClipOptions, "signal" | "onPhaseChange"> = {},
) {
  return exportClip({
    ...lifecycle,
    mediaSource: {
      kind: "file",
      role: "local-file",
      label: "Test source",
      file,
      fileName: file.name,
    },
    mode: "audio-only",
    format,
    mixDownToStereo,
    resolution: "original",
    startTime,
    endTime,
    metadata: {
      providerId: "test",
      ratingKey: "private",
      itemType: "episode",
      title: "Dialogue 日本語",
      showTitle: "Series",
      seasonNumber: 2,
      episodeNumber: 3,
      directors: ["Director"],
    },
    onProgress: () => {},
  });
}

async function checkWorkerCancellation() {
  const file = createPcmWav({
    bits: 16,
    samples: Array.from({ length: 48_000 * 30 }, (_, index) => index % 16_000),
  });
  for (const phase of ["preparing", "encoding"] as const) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let aborted = false;
    try {
      await convert(file, "mp3", true, 0, 30, {
        signal: controller.signal,
        onPhaseChange: (nextPhase) => {
          if (nextPhase === phase) {
            if (phase === "preparing") {
              controller.abort();
            } else {
              // Exercise cancellation while the extension worker is initializing/encoding.
              timer = setTimeout(() => controller.abort(), 10);
            }
          }
        },
      });
    } catch (error) {
      aborted = error instanceof Error && error.name === "AbortError";
    } finally {
      clearTimeout(timer);
    }
    check(aborted, `MP3 ${phase} cancellation did not reject with AbortError`);
    const retry = await convert(file, "mp3");
    check(retry.size > 0, "MP3 retry failed after cancellation");
  }
}

async function channelEnergy(blob: Blob) {
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryAudioTrack();
    check(track !== null, "Missing output audio");
    const info = await inspectAudioTrack(track);
    const energy = Array.from({ length: info.numberOfChannels }, () => 0);
    for await (const sample of new AudioSampleSink(track).samples()) {
      try {
        const plane = new Float32Array(sample.numberOfFrames);
        for (let channel = 0; channel < energy.length; channel++) {
          sample.copyTo(plane, { format: "f32-planar", planeIndex: channel });
          for (const value of plane) {
            energy[channel] += value * value;
          }
        }
      } finally {
        sample.close();
      }
    }
    return { info, energy };
  } finally {
    input.dispose();
  }
}

async function readMonoPcm(blob: Blob) {
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryAudioTrack();
    check(
      track !== null && (await track.getNumberOfChannels()) === 1,
      "Missing mono track",
    );
    const values: number[] = [];
    for await (const sample of new AudioSampleSink(track).samples()) {
      try {
        const data = new Float32Array(sample.numberOfFrames);
        sample.copyTo(data, { format: "f32-planar", planeIndex: 0 });
        values.push(...data);
      } finally {
        sample.close();
      }
    }
    return values;
  } finally {
    input.dispose();
  }
}

async function checkShortFlacExports() {
  for (const sampleRate of [8000, 48_000]) {
    for (const bits of [16, 24] as const) {
      for (const count of [1, 15, 16, 800, 4096, 4097, 8192]) {
        const samples = Array.from(
          { length: count },
          (_, index) => (index % 257) * 17 - 2048,
        );
        const file = createPcmWav({ bits, sampleRate, samples });
        if (count <= 4097) {
          let rejected = false;
          try {
            await convert(file, "flac", true, 0, count / sampleRate);
          } catch (error) {
            rejected =
              error instanceof Error &&
              error.message.includes("cannot be exported reliably as FLAC");
          }
          check(rejected, "Single-frame FLAC must explain the WAV alternative");
          continue;
        }
        const blob = await convert(file, "flac", true, 0, count / sampleRate);
        // Inspect the actual container independently of MediaBunny's metadata reader.
        const bytes = await blob.arrayBuffer();
        const header = new DataView(bytes);
        check(
          new TextDecoder().decode(new Uint8Array(bytes, 0, 4)) === "fLaC",
          "Missing FLAC signature",
        );
        const minimum = header.getUint16(8);
        const maximum = header.getUint16(10);
        check(
          minimum >= 16 && maximum >= minimum,
          "Invalid FLAC STREAMINFO block sizes",
        );
        const decoded = await readMonoPcm(blob);
        check(
          decoded.length === count,
          `Short FLAC changed sample count: ${bits}-bit ${sampleRate} Hz, expected ${count}, got ${decoded.length}`,
        );
        check(
          decoded.every(
            (value, index) => value === samples[index] / 2 ** (bits - 1),
          ),
          "Short FLAC changed PCM values",
        );
        if (sampleRate === 8000 && bits === 16 && count === 8192) {
          const context = new OfflineAudioContext(1, count, sampleRate);
          const independent = await context.decodeAudioData(bytes);
          check(
            independent.length === count,
            "Independent FLAC playback failed",
          );
        }
      }
    }
  }
}

async function checkAacSurroundMixdown() {
  const { default: probes } = await import("#/lib/audioLayoutProbes.json");
  const file = new File(
    [
      Uint8Array.from(
        atob(probes["aac:8"].data),
        (character) => character.codePointAt(0) ?? 0,
      ),
    ],
    "surround.m4a",
  );
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryAudioTrack();
    check(track !== null, "Missing AAC surround source");
    const info = await inspectAudioTrack(track);
    check(
      info.numberOfChannels === 8 &&
        info.layout !== null &&
        info.layout.includes("C") &&
        info.layout.includes("LFE"),
      "AAC 7.1 configuration was not identified",
    );
  } finally {
    input.dispose();
  }
  const stereo = await channelEnergy(await convert(file, "mp3", true, 0, 0.2));
  check(
    stereo.info.numberOfChannels === 2 &&
      stereo.energy.every((value) => value > 1),
    "AAC 7.1 stereo mixdown failed",
  );
}

async function dialogueSource(channels: number) {
  await ensureAudioEncoder("flac");
  const target = new BufferTarget();
  const output = new Output({ target, format: new FlacOutputFormat() });
  const source = new AudioSampleSource({ codec: "flac" });
  output.addAudioTrack(source);
  await output.start();
  const data = new Float32Array(48_000 * channels);
  for (let frame = 0; frame < 48_000; frame++) {
    data[frame * channels + 2] =
      0.5 * Math.sin((2 * Math.PI * 440 * frame) / 48_000);
  }
  const sample = new AudioSample({
    data,
    format: "f32",
    numberOfChannels: channels,
    sampleRate: 48_000,
    timestamp: 0,
  });
  try {
    await source.add(sample);
    source.close();
    await output.finalize();
  } finally {
    sample.close();
    if (output.state !== "finalized") {
      await output.cancel();
    }
  }
  check(target.buffer !== null, "Missing fixture buffer");
  return new File([target.buffer], "dialogue.flac", { type: "audio/flac" });
}

async function runAudioExportChecks() {
  const checks: string[] = [];
  document.title = "Checking worker cancellation";
  await checkWorkerCancellation();
  checks.push("MP3 preparation/worker cancellation and retry");
  const samples = Array.from({ length: 48_000 }, (_, frame) =>
    Math.round(12_000 * Math.sin((2 * Math.PI * 440 * frame) / 48_000)),
  );
  const mono = createPcmWav({ bits: 16, samples });
  for (const format of ["mp3", "m4a", "ogg", "flac", "wav"] as const) {
    document.title = `Checking ${format}`;
    const blob = await convert(mono, format);
    const input = new Input({
      source: new BlobSource(blob),
      formats: ALL_FORMATS,
    });
    try {
      const mimeType = await input.getMimeType();
      check(
        blob.type.startsWith("audio/") && blob.type === mimeType.toLowerCase(),
        `${format}: output MIME type does not describe the actual tracks`,
      );
      const track = await input.getPrimaryAudioTrack();
      check(
        track !== null && (await track.getNumberOfChannels()) === 1,
        `${format}: mono changed`,
      );
      check(
        (await input.getPrimaryVideoTrack()) === null,
        `${format}: unexpected video`,
      );
      const tags = await input.getMetadataTags();
      check(
        tags.title === "Dialogue 日本語",
        `${format}: Unicode title missing`,
      );
      check(
        tags.comment?.includes("00:00:00.125 to 00:00:00.750") === true,
        `${format}: source interval changed`,
      );
      check(
        JSON.stringify(tags.raw).includes("sourceStartSeconds"),
        `${format}: payload missing`,
      );
    } finally {
      input.dispose();
    }
    const decoded = await channelEnergy(blob);
    check(decoded.energy[0] > 1, `${format}: speech disappeared`);
    checks.push(`${format} output, metadata, mono speech, and worker loading`);
  }
  for (const rate of [8000, 11_025, 12_000]) {
    for (const channels of [1, 2]) {
      const file = createPcmWav({
        bits: 16,
        channels,
        sampleRate: rate,
        samples: Array.from({ length: rate * channels }, (_, index) =>
          Math.round(
            12_000 *
              Math.sin(
                (2 * Math.PI * 440 * Math.floor(index / channels)) / rate,
              ),
          ),
        ),
      });
      const blob = await convert(file, "mp3");
      const input = new Input({
        source: new BlobSource(blob),
        formats: ALL_FORMATS,
      });
      try {
        const track = await input.getPrimaryAudioTrack();
        check(track !== null, "MP3 track missing");
        check((await track.getSampleRate()) === rate, "MP3 rate changed");
        const packet = await new EncodedPacketSink(track).getFirstPacket();
        check(
          packet !== null &&
            Math.abs((packet.data.byteLength * 8) / packet.duration - 64_000) <
              1000,
          "MP3 bitrate differs from resolved plan",
        );
        check(
          (await track.getNumberOfChannels()) === channels,
          "MP3 channels changed",
        );
      } finally {
        input.dispose();
      }
    }
  }
  checks.push("8/11.025/12 kHz MP3 bitrate and channel counts");
  document.title = "Checking AAC dialogue";
  const three = await dialogueSource(3);
  let rejected = false;
  try {
    await convert(three, "m4a", false);
  } catch (error) {
    rejected =
      error instanceof Error && error.message.includes("No encoder supports");
  }
  check(rejected, "Three-channel AAC must not relabel center as LFE");
  const stereo = await channelEnergy(await convert(three, "m4a"));
  check(stereo.info.numberOfChannels === 2, "Dialogue mix is not stereo");
  check(
    stereo.energy.every((value) => value > 1),
    "Dialogue missing from stereo mix",
  );
  check(
    Math.abs(stereo.energy[0] / stereo.energy[1] - 1) < 0.02,
    "Dialogue is not centered",
  );
  for (const channels of [5, 6]) {
    document.title = `Checking AAC ${channels} channels`;
    const source = await dialogueSource(channels);
    const preserved = await channelEnergy(await convert(source, "m4a", false));
    const center = preserved.info.layout?.indexOf("C") ?? -1;
    check(
      center >= 0 && preserved.energy[center] > 1,
      "Preserved center dialogue missing",
    );
    check(
      preserved.energy.every(
        (value, index) => index === center || value < 0.001,
      ),
      "Center dialogue moved to another speaker",
    );
  }
  checks.push(
    "AAC dialogue mixdown, verified preservation, and unsupported layout rejection",
  );
  document.title = "Checking AAC 7.1 mixdown";
  await checkAacSurroundMixdown();
  checks.push(
    "real AAC configuration 12 source inspection and stereo MP3 export",
  );
  document.title = "Checking single-frame FLAC";
  await checkShortFlacExports();
  checks.push(
    "single-frame FLAC rejection, multi-frame precision, and independent playback",
  );
  document.title = "Checking unsigned PCM";
  const pattern = [0, 128, 128, 255, 1, 127, 129, 64, 255];
  const values = Array.from(
    { length: 4800 },
    (_, index) => pattern[index % pattern.length],
  );
  const unsigned = createPcmWav({ bits: 8, samples: values });
  for (const format of ["wav", "flac"] as const) {
    const blob = await convert(
      unsigned,
      format,
      true,
      1 / 48_000,
      (values.length - 1) / 48_000,
    );
    let checkedBlob = blob;
    if (format === "flac") {
      checkedBlob = await convert(
        new File([blob], "roundtrip.flac"),
        "wav",
        true,
        0,
        (values.length - 2) / 48_000,
      );
    }
    const actual = await readMonoPcm(checkedBlob);
    check(
      actual.length === values.length - 2 &&
        actual.every(
          (value, index) => value === (values[index + 1] - 128) / 128,
        ),
      `${format}: unsigned PCM trim changed samples`,
    );
  }
  checks.push("unsigned 8-bit PCM exact WAV/FLAC round trips after trimming");
  document.title = "Audio export checks passed";
  return checks;
}

declare global {
  var runAudioExportChecks: () => Promise<string[]>;
}
globalThis.runAudioExportChecks = runAudioExportChecks;
