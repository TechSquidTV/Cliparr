import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";

import { exportClip } from "#/lib/export/exportClip";
import { cloneCanvasFrame } from "#/lib/framegrab";
import { renderSubtitleCues } from "#/lib/subtitles/renderSubtitleCue";
import { loadSubtitleStyleSettings } from "#/lib/subtitles/settings";
import type { VideoCrop } from "#/lib/videoCrop";

function check(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function firstFrame(blob: Blob) {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(blob),
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    check(track !== null, "Missing exported video track");
    const frame = await new CanvasSink(track).getCanvas(0);
    check(frame !== null, "Missing exported frame");
    const canvas = document.createElement("canvas");
    canvas.width = await track.getDisplayWidth();
    canvas.height = await track.getDisplayHeight();
    const context = canvas.getContext("2d");
    check(context !== null, "Missing decode canvas");
    context.drawImage(frame.canvas, 0, 0);
    return canvas;
  } finally {
    input.dispose();
  }
}

function compareFrames(actual: HTMLCanvasElement, expected: HTMLCanvasElement) {
  check(
    actual.width === expected.width && actual.height === expected.height,
    `Unexpected output dimensions: ${actual.width} × ${actual.height}`,
  );
  const left = actual
    .getContext("2d")
    ?.getImageData(0, 0, actual.width, actual.height).data;
  const right = expected
    .getContext("2d")
    ?.getImageData(0, 0, expected.width, expected.height).data;
  check(left !== undefined && right !== undefined, "Missing pixel data");
  let error = 0;
  for (const [index, element] of left.entries()) {
    error += Math.abs(element - right[index]);
  }
  check(
    error / left.length < 5,
    `Cropped pixels differ: ${error / left.length}`,
  );
}

export async function checkCropExports(file: File) {
  const original = await firstFrame(file);
  const crop: VideoCrop = {
    x: 0.25,
    y: 0.2,
    width: 0.5,
    height: 0.6,
    sourceAspectRatio: 16 / 9,
  };
  const expected = cloneCanvasFrame(original, null, crop);
  check(
    expected.width === 480 && expected.height === 324,
    "Framegrab crop size",
  );
  // Compare against an independent pixel extraction, including all four edges.
  const extracted = document.createElement("canvas");
  extracted.width = 480;
  extracted.height = 324;
  const originalContext = original.getContext("2d");
  check(originalContext !== null, "Missing source context");
  extracted
    .getContext("2d")
    ?.putImageData(originalContext.getImageData(240, 108, 480, 324), 0, 0);
  compareFrames(expected, extracted);
  const mediaSource = {
    kind: "file",
    role: "local-file",
    label: "Test source",
    file,
    fileName: file.name,
  } as const;
  const common = {
    mediaSource,
    crop,
    mode: "video-only",
    startTime: 0,
    endTime: 0.4,
    resolution: "original",
    onProgress: () => {},
  } as const;
  let mode = "";
  const video = await exportClip({
    ...common,
    format: "webm",
    onVideoEncodingPlan: (plan) => {
      mode = plan.mode;
    },
  });
  check(mode === "transcode", "Cropping must re-encode");
  compareFrames(await firstFrame(video), expected);

  const cues = [
    { startTime: 0, endTime: 0.4, text: "CROPPED", lines: ["CROPPED"] },
  ];
  const style = {
    ...loadSubtitleStyleSettings(),
    fontSize: 120,
    fontColor: "#ff00ff",
    positionY: 50,
    strokeWidth: 0,
    shadowBlur: 0,
    shadowOffsetY: 0,
  };
  const overlay = document.createElement("canvas");
  overlay.width = expected.width;
  overlay.height = expected.height;
  const overlayContext = overlay.getContext("2d");
  check(overlayContext !== null, "Missing subtitle context");
  renderSubtitleCues(
    overlayContext,
    cues,
    style,
    overlay.width,
    overlay.height,
  );
  const subtitled = cloneCanvasFrame(original, overlay, crop);
  const captionedVideo = await exportClip({
    ...common,
    format: "webm",
    includeBurnedSubtitles: true,
    subtitleCues: cues,
    subtitleStyleSettings: style,
  });
  const captionedFrame = await firstFrame(captionedVideo);
  compareFrames(captionedFrame, subtitled);
  const magentaPixels = (canvas: HTMLCanvasElement) => {
    const pixels = canvas
      .getContext("2d")
      ?.getImageData(0, 0, canvas.width, canvas.height).data;
    check(pixels !== undefined, "Missing caption pixels");
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        pixels[index] > 180 &&
        pixels[index + 1] < 80 &&
        pixels[index + 2] > 180
      ) {
        count++;
      }
    }
    return count;
  };
  check(
    magentaPixels(captionedFrame) > magentaPixels(subtitled) * 0.7,
    "Video captions missing after crop",
  );
  const resized = await exportClip({
    ...common,
    format: "webm",
    resolution: "720",
    includeBurnedSubtitles: true,
    subtitleCues: cues,
    subtitleStyleSettings: style,
  });
  const resizedFrame = await firstFrame(resized);
  check(
    resizedFrame.width === 1066 && resizedFrame.height === 720,
    "Crop must precede resize",
  );
  check(
    magentaPixels(resizedFrame) > magentaPixels(subtitled),
    "Resized captions missing",
  );

  const gif = await exportClip({
    ...common,
    format: "gif",
    includeBurnedSubtitles: true,
    subtitleCues: cues,
    subtitleStyleSettings: style,
  });
  const bitmap = await createImageBitmap(gif);
  const gifFrame = document.createElement("canvas");
  gifFrame.width = bitmap.width;
  gifFrame.height = bitmap.height;
  gifFrame.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  compareFrames(gifFrame, subtitled);
  check(
    magentaPixels(gifFrame) > magentaPixels(subtitled) * 0.7,
    "GIF captions missing after crop",
  );
  return [
    "framegrab crop pixels",
    "video crop and re-encoding",
    "video/GIF subtitle placement after crop",
  ];
}
