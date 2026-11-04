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
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  check(context !== null, "Missing decode canvas");
  if (blob.type === "image/gif") {
    const bitmap = await createImageBitmap(blob);
    try {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      context.drawImage(bitmap, 0, 0);
      return canvas;
    } finally {
      bitmap.close();
    }
  }
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(blob),
  });
  try {
    const track = await input.getPrimaryVideoTrack();
    check(track !== null, "Missing exported video track");
    const frame = await new CanvasSink(track).getCanvas(0);
    check(frame !== null, "Missing exported frame");
    canvas.width = await track.getDisplayWidth();
    canvas.height = await track.getDisplayHeight();
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
  const actualContext = actual.getContext("2d");
  const expectedContext = expected.getContext("2d");
  check(actualContext !== null && expectedContext !== null, "Missing pixels");
  const { width, height } = expected;
  // Whole-frame averages can hide narrow borders. Check each outermost pixel
  // row/column independently, allowing a little extra codec error at edges.
  for (const [name, x, y, w, h, tolerance] of [
    ["frame", 0, 0, width, height, 5],
    ["left", 0, 0, 1, height, 8],
    ["right", width - 1, 0, 1, height, 8],
    ["top", 0, 0, width, 1, 8],
    ["bottom", 0, height - 1, width, 1, 8],
  ] as const) {
    const left = actualContext.getImageData(x, y, w, h).data;
    const right = expectedContext.getImageData(x, y, w, h).data;
    let error = 0;
    for (const [index, element] of left.entries()) {
      error += Math.abs(element - right[index]);
    }
    check(
      error / left.length < tolerance,
      `Cropped ${name} pixels differ (${width} × ${height}): ${error / left.length}`,
    );
  }
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

  // Odd landscape and portrait crops exercise both horizontal and vertical
  // padding from contain. Expected pixels use independent canvas extraction
  // and scaling, not the production crop or output-dimension helpers.
  for (const [
    left,
    top,
    width,
    height,
    videoWidth,
    videoHeight,
    gifWidth,
    gifHeight,
  ] of [
    [80, 120, 800, 101, 800, 100, 800, 101],
    [400, 10, 101, 501, 100, 500, 97, 480],
  ] as const) {
    const oddCrop: VideoCrop = {
      x: left / original.width,
      y: top / original.height,
      width: width / original.width,
      height: height / original.height,
      sourceAspectRatio: original.width / original.height,
    };
    for (const [format, outputWidth, outputHeight] of [
      ["webm", videoWidth, videoHeight],
      ["gif", gifWidth, gifHeight],
    ] as const) {
      const reference = document.createElement("canvas");
      reference.width = outputWidth;
      reference.height = outputHeight;
      const referenceContext = reference.getContext("2d");
      check(referenceContext !== null, "Missing odd crop context");
      referenceContext.drawImage(
        original,
        left,
        top,
        width,
        height,
        0,
        0,
        outputWidth,
        outputHeight,
      );
      const exported = await exportClip({ ...common, crop: oddCrop, format });
      compareFrames(await firstFrame(exported), reference);
    }
  }

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
  const gifFrame = await firstFrame(gif);
  compareFrames(gifFrame, subtitled);
  check(
    magentaPixels(gifFrame) > magentaPixels(subtitled) * 0.7,
    "GIF captions missing after crop",
  );
  return [
    "framegrab crop pixels",
    "video crop and re-encoding",
    "odd-dimension video/GIF crops preserve all four edges",
    "video/GIF subtitle placement after crop",
  ];
}
