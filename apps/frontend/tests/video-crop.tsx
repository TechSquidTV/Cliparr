import {
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  BufferTarget,
  CanvasSource,
  Output,
  Quality,
  WebMOutputFormat,
} from "mediabunny";
import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { buildLocalEditorSession } from "#/components/editor/editorMedia";
import EditorScreen from "#/components/editor/EditorScreen";
import { EditorSubtitlePreview } from "#/components/editor/EditorSubtitlePreview";
import { TooltipProvider } from "#/components/ui/tooltip";
import { loadSubtitleStyleSettings } from "#/lib/subtitles/settings";
import { checkCropExports } from "#tests/video-crop-exports.ts";

const picture = document.createElement("canvas");
picture.width = 960;
picture.height = 540;
const context = picture.getContext("2d");
if (!context) {
  throw new Error("Missing fixture context");
}
const sky = context.createLinearGradient(0, 0, 0, 540);
sky.addColorStop(0, "#263d66");
sky.addColorStop(0.6, "#cf977c");
sky.addColorStop(1, "#293c4b");
context.fillStyle = sky;
context.fillRect(0, 0, 960, 540);
context.fillStyle = "#f8ddb0";
context.beginPath();
context.arc(650, 190, 62, 0, Math.PI * 2);
context.fill();
for (const [color, height, offset] of [
  ["#3d5261", 310, 0],
  ["#203c47", 380, 90],
  ["#122b35", 450, 180],
] as const) {
  context.fillStyle = color;
  const mountain = new Path2D();
  mountain.moveTo(0, 540);
  for (let x = 0; x <= 960; x += 30) {
    mountain.lineTo(x, height + Math.sin((x + offset) / 140) * 70);
  }
  mountain.lineTo(960, 540);
  mountain.closePath();
  context.fill(mountain);
}
context.fillStyle = "#ffffff";
context.font = "22px sans-serif";
context.fillText("COASTAL TRAIL", 42, 52);
context.font = "14px sans-serif";
context.fillText("Synthetic video · 960 × 540", 42, 78);
const target = new BufferTarget();
const output = new Output({ format: new WebMOutputFormat(), target });
const source = new CanvasSource(picture, {
  codec: "vp8",
  quality: new Quality({ bitrate: 1_000_000 }),
});
output.addVideoTrack(source, { frameRate: 10 });
await output.start();
for (let frame = 0; frame < 40; frame++) {
  await source.add(frame / 10, 0.1);
}
source.close();
await output.finalize();
if (!target.buffer) {
  throw new Error("Missing fixture video");
}
const file = new File([target.buffer], "coastal-trail.webm", {
  type: "video/webm",
  lastModified: 1,
});
const session = buildLocalEditorSession({
  id: "crop-browser-fixture",
  title: "Coastal trail",
  duration: 4,
  source: {
    kind: "file",
    role: "local-file",
    label: "Local file",
    file,
    fileName: file.name,
  },
});
const fixture = new URLSearchParams(window.location.search).get("fixture");
if (fixture === "delayed-subtitles") {
  // Reuse the synthetic media while exercising the provider import lifecycle.
  session.local = false;
  session.subtitleTracks = [
    {
      streamId: "crop-subtitles",
      isText: true,
      contentFormat: "vtt",
      contentUrl: "/tests/delayed-crop-subtitles.vtt",
    },
  ];
}
const subtitleFrameDimensions = { width: 960, height: 540 };
const subtitleFrameCrop = {
  x: 0.25,
  y: 0.25,
  width: 0.5,
  height: 0.5,
  sourceAspectRatio: 16 / 9,
};
const subtitleFrameCues = [
  { startTime: 0, endTime: 4, text: "FRAME ZERO", lines: ["FRAME ZERO"] },
];
const subtitleFrameStyle = loadSubtitleStyleSettings();
function SubtitleFirstFrameFixture() {
  const videoCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setFrameReady(true)}>
        Render first frame
      </button>
      <div className="relative h-60 w-full">
        <canvas
          ref={videoCanvasRef}
          width={frameReady ? 960 : 300}
          height={frameReady ? 540 : 150}
        />
        <EditorSubtitlePreview
          cues={subtitleFrameCues}
          currentTime={0}
          frameReady={frameReady}
          enabled
          overlayCanvasRef={overlayCanvasRef}
          style={subtitleFrameStyle}
          videoCanvasRef={videoCanvasRef}
          videoDimensions={subtitleFrameDimensions}
          crop={subtitleFrameCrop}
        />
      </div>
    </>
  );
}
const route = createRootRoute({
  component: () => (
    <TooltipProvider>
      {fixture === "first-frame" ? (
        <SubtitleFirstFrameFixture />
      ) : (
        <EditorScreen session={session} onBack={() => {}} />
      )}
    </TooltipProvider>
  ),
});
const router = createRouter({ routeTree: route });
document.documentElement.classList.add("dark");
const root = document.querySelector("#root");
if (!root) {
  throw new Error("Missing fixture root");
}
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

declare global {
  var runVideoCropExportChecks: () => Promise<string[]>;
}
globalThis.runVideoCropExportChecks = () => checkCropExports(file);
