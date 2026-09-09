import { stat } from "node:fs/promises";
import path from "node:path";
import { run } from "#/process.ts";
import type { CaptureScene } from "#/scenes.ts";

interface Probe {
  streams: {
    codec_name: string;
    codec_type: string;
    width: number;
    height: number;
    pix_fmt?: string;
  }[];
  format: { duration?: string };
}

async function probe(file: string): Promise<Probe> {
  return JSON.parse(
    await run(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      { capture: true },
    ),
  ) as Probe;
}

export function validateVideo(
  details: Probe,
  scene: CaptureScene,
  codec: string,
) {
  const [video] = details.streams;
  if (
    details.streams.length !== 1 ||
    video?.codec_type !== "video" ||
    video.codec_name !== codec ||
    video.width !== scene.viewport.width ||
    video.height !== scene.viewport.height ||
    video.pix_fmt !== "yuv420p"
  ) {
    throw new Error(
      `${scene.name}: unexpected dimensions, codec, pixel format, or audio stream.`,
    );
  }
  const duration = Number(details.format.duration);
  if (
    !Number.isFinite(duration) ||
    Math.abs(duration - scene.recordingSeconds) > 1 / 30 + 0.005
  ) {
    throw new Error(
      `${scene.name}: output duration does not match the recording window.`,
    );
  }
}

export async function encodeScene(
  scene: CaptureScene,
  directory: string,
  startOffsetSeconds: number,
) {
  const raw = path.join(directory, `${scene.name}-raw.webm`);
  const mp4 = `${scene.videoName}.mp4`;
  const webm = `${scene.videoName}.webm`;
  const poster = `${scene.posterName}.webp`;
  const common = [
    "-v",
    "error",
    "-y",
    "-i",
    raw,
    "-ss",
    String(startOffsetSeconds),
    "-t",
    String(scene.recordingSeconds),
    "-an",
    "-vf",
    "fps=30,setsar=1",
    "-pix_fmt",
    "yuv420p",
  ];
  await run("ffmpeg", [
    ...common,
    "-c:v",
    "libx264",
    "-crf",
    "23",
    "-preset",
    "slow",
    "-movflags",
    "+faststart",
    path.join(directory, mp4),
  ]);
  await run("ffmpeg", [
    ...common,
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "30",
    "-b:v",
    "0",
    "-deadline",
    "good",
    "-cpu-used",
    "1",
    path.join(directory, webm),
  ]);
  // Decode the delivered MP4's first frame so the poster uses the same framing.
  await run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    path.join(directory, mp4),
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    "-quality",
    "72",
    path.join(directory, poster),
  ]);
  const files = [];
  for (const [name, codec] of [
    [mp4, "h264"],
    [webm, "vp9"],
  ] as const) {
    const file = path.join(directory, name);
    validateVideo(await probe(file), scene, codec);
    await run(
      "ffmpeg",
      ["-v", "error", "-xerror", "-i", file, "-f", "null", "-"],
      { capture: true },
    );
    const { size } = await stat(file);
    files.push({ name, bytes: size, overTarget: size > scene.targetBytes });
  }
  const posterProbe = await probe(path.join(directory, poster));
  if (
    posterProbe.streams[0]?.width !== scene.viewport.width ||
    posterProbe.streams[0].height !== scene.viewport.height
  ) {
    throw new Error(`${scene.name}: poster dimensions do not match video.`);
  }
  return {
    scene: scene.name,
    selection: scene.selection,
    recordingSeconds: scene.recordingSeconds,
    files,
    poster,
  };
}
