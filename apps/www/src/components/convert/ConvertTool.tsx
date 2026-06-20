import {
  DEFAULT_GIF_EXPORT_PRESET,
  DEFAULT_VIDEO_EXPORT_QUALITY,
  EditorExportSettingsSection,
  EditorExportSummaryPanel,
  TooltipProvider,
  compactPrimaryButtonClasses,
  createCliparrInputFromSource,
  destructiveAlertClasses,
  estimateExportOutputSize,
  exportFormatDurationDisabledReason,
  formatOptionFor,
  formatExportByteSize,
  getTrackTimelineOffsetSeconds,
  getVideoTrackDimensions,
  gifExportSettingsForPreset,
  primaryAlertClasses,
  resolveExportOutputDimensions,
  titleFromFileName,
  type EditorFileMediaSource,
  type ExportFormat,
  type ExportQualityPreset,
  type ExportResolution,
  type GifExportPreset,
  type VideoExportQualityPreset,
} from "@cliparr/frontend/convert";
import { Download, FolderOpen, RefreshCcw, Upload } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  buildConvertedFileBaseName,
  buildConvertedOutputFileName,
  buildLocalFileSource,
  formatDuration,
  resolveConvertIncludeAudio,
  runConvertExport,
  selectedQualityForFormat,
  type SourceProbeResult,
} from "@/components/convert/convertToolUtilities";
import { MediabunnySourcePreview } from "@/components/convert/MediabunnySourcePreview";

type ProbeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: SourceProbeResult }
  | { status: "error"; message: string };

const fileAccept = [
  "video/*",
  "video/x-matroska",
  "application/x-matroska",
  "video/mp2t",
  ".mp4",
  ".m4v",
  ".mov",
  ".mkv",
  ".webm",
  ".ogv",
  ".ts",
  ".m2ts",
  ".mts",
].join(",");

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isVideoExportQuality(
  quality: ExportQualityPreset,
): quality is VideoExportQualityPreset {
  return quality !== "efficient";
}

function probeKeyFor(file: File | null) {
  return file ? `${file.name}:${file.size}:${file.lastModified}` : "";
}

function dimensionsLabel(result: SourceProbeResult | null) {
  return result
    ? `${result.dimensions.width} x ${result.dimensions.height}`
    : "Unknown";
}

function probeErrorMessage(error: unknown) {
  return errorMessage(
    error,
    "Could not inspect this file. Try another video format.",
  );
}

type QuickTemplate = {
  id:
    | "gif-from-video"
    | "webm-for-web"
    | "mp4-high-quality"
    | "mpeg-ts-to-mp4"
    | "mkv-to-mp4"
    | "compress-video";
  title: string;
  description: string;
};

const quickTemplates: readonly QuickTemplate[] = [
  {
    id: "gif-from-video",
    title: "Video to GIF",
    description: "GIF output with compact dimensions for easy sharing.",
  },
  {
    id: "webm-for-web",
    title: "MP4 to WebM",
    description: "Smaller web previews with efficient modern compression.",
  },
  {
    id: "mp4-high-quality",
    title: "High-quality MP4",
    description: "Crisp exports for maximum compatibility across devices.",
  },
  {
    id: "mpeg-ts-to-mp4",
    title: "MPEG-TS to MP4",
    description: "Convert TS, M2TS, or MTS transport streams to MP4.",
  },
  {
    id: "mkv-to-mp4",
    title: "MKV to MP4",
    description: "Remux or convert MKV videos into a familiar MP4 file.",
  },
  {
    id: "compress-video",
    title: "Compress video file",
    description: "Smaller MP4 output for sharing, email, and uploads.",
  },
] as const;

interface ProbeVideoTrack {
  hasOnlyKeyPackets: () => Promise<boolean>;
}

async function probeSource(source: EditorFileMediaSource) {
  const input = await createCliparrInputFromSource(source);

  try {
    const videoTrack = await input.getPrimaryVideoTrack({
      filter: async (track: ProbeVideoTrack) =>
        !(await track.hasOnlyKeyPackets()),
    });

    if (!videoTrack) {
      throw new Error("This file does not contain an exportable video track.");
    }

    const audioTracks = await input.getAudioTracks();
    const durationTracks = [videoTrack, ...audioTracks];
    const previewStartTimestampSeconds = Math.max(
      await videoTrack.getFirstTimestamp(),
      0,
    );
    const timelineOffsetSeconds =
      await getTrackTimelineOffsetSeconds(durationTracks);
    const metadataDuration =
      await input.getDurationFromMetadata(durationTracks);
    const sourceTimelineEnd =
      metadataDuration && metadataDuration > 0
        ? metadataDuration
        : await input.computeDuration(durationTracks);
    const durationSeconds = Math.max(
      0,
      sourceTimelineEnd - timelineOffsetSeconds,
    );

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("Could not determine this file's duration.");
    }

    const dimensions = await getVideoTrackDimensions(videoTrack);

    return {
      durationSeconds,
      previewStartTimestampSeconds,
      dimensions,
      hasAudio: audioTracks.length > 0,
    } satisfies SourceProbeResult;
  } finally {
    input.dispose();
  }
}

export function ConvertTool() {
  const fileInputId = useId();
  const outputNameInputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [source, setSource] = useState<EditorFileMediaSource | null>(null);
  const [probeState, setProbeState] = useState<ProbeState>({
    status: "idle",
  });
  const [format, setFormat] = useState<ExportFormat>("mp4");
  const [resolution, setResolution] = useState<ExportResolution>("original");
  const [gifPreset, setGifPreset] = useState<GifExportPreset>(
    DEFAULT_GIF_EXPORT_PRESET,
  );
  const [videoQuality, setVideoQuality] = useState<VideoExportQualityPreset>(
    DEFAULT_VIDEO_EXPORT_QUALITY,
  );
  const [includeAudio, setIncludeAudio] = useState(true);
  const [outputNameStem, setOutputNameStem] = useState("converted-video");
  const [isConverterReady, setIsConverterReady] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);

  const sourceFile = source?.file ?? null;
  const canSelectFile = isConverterReady && !exporting;
  const sourceProbeKey = probeKeyFor(sourceFile);
  const probeResult = probeState.status === "ready" ? probeState.result : null;
  const sourceTitle = sourceFile
    ? titleFromFileName(sourceFile.name)
    : "No file selected";
  const gifSettings = useMemo(
    () => gifExportSettingsForPreset(gifPreset),
    [gifPreset],
  );
  const selectedQuality = selectedQualityForFormat({
    format,
    gifPreset,
    videoQuality,
  });
  const outputDimensions = useMemo(
    () =>
      resolveExportOutputDimensions(
        probeResult?.dimensions ?? null,
        resolution,
        format,
        format === "gif" ? gifSettings : undefined,
      ),
    [format, gifSettings, probeResult?.dimensions, resolution],
  );
  const effectiveIncludeAudio = resolveConvertIncludeAudio(
    format,
    includeAudio && (probeResult?.hasAudio ?? true),
  );
  const outputSizeEstimate = useMemo(
    () =>
      probeResult && sourceFile
        ? estimateExportOutputSize({
            format,
            durationSeconds: probeResult.durationSeconds,
            outputDimensions,
            includeAudio: effectiveIncludeAudio,
            resolution,
            gifSettings: format === "gif" ? gifSettings : null,
            sourceSizeBytes: sourceFile.size,
            sourceDurationSeconds: probeResult.durationSeconds,
            videoQuality: format === "gif" ? null : videoQuality,
          })
        : { bytes: null, basis: "unavailable" as const },
    [
      effectiveIncludeAudio,
      format,
      gifSettings,
      outputDimensions,
      probeResult,
      resolution,
      sourceFile,
      videoQuality,
    ],
  );
  const formatDisabledReason = probeResult
    ? exportFormatDurationDisabledReason(format, 0, probeResult.durationSeconds)
    : null;
  let exportDisabledReason = formatDisabledReason;
  if (!source || !probeResult) {
    exportDisabledReason = "Choose a file.";
  }
  if (probeState.status === "error") {
    exportDisabledReason = "Choose another file.";
  }
  if (probeState.status === "loading") {
    exportDisabledReason = "Inspecting file.";
  }
  const outputFileName = buildConvertedOutputFileName(outputNameStem, format);
  const outputEstimateLabel =
    typeof outputSizeEstimate.bytes === "number"
      ? `~${formatExportByteSize(outputSizeEstimate.bytes)}`
      : "Unavailable";
  const selectedFormatOption = formatOptionFor(format);
  const emptyDropZoneTitle = isConverterReady
    ? "Drop a video file here"
    : "Preparing converter";
  const emptyDropZoneDescription = isConverterReady
    ? "MP4, MOV, MKV, WebM, Ogg video, and MPEG-TS are supported."
    : "The file picker will be ready in a moment.";
  let audioDisabledReason: string | null = null;
  if (probeResult && !probeResult.hasAudio) {
    audioDisabledReason = "No source audio detected.";
  }
  if (format === "gif") {
    audioDisabledReason = "GIF output is video only.";
  }
  let sourceProbeContent: ReactNode;
  switch (probeState.status) {
    case "idle": {
      sourceProbeContent = (
        <p className="text-sm text-muted-foreground">No file selected.</p>
      );
      break;
    }
    case "loading": {
      sourceProbeContent = (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          Inspecting media
        </div>
      );
      break;
    }
    case "error": {
      sourceProbeContent = (
        <p className="text-sm text-destructive">{probeState.message}</p>
      );
      break;
    }
    case "ready": {
      sourceProbeContent = (
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              Duration
            </dt>
            <dd className="mt-1 font-mono text-sm text-foreground">
              {formatDuration(probeState.result.durationSeconds)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              Dimensions
            </dt>
            <dd className="mt-1 font-mono text-sm text-foreground">
              {dimensionsLabel(probeState.result)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              Audio
            </dt>
            <dd className="mt-1 text-sm text-foreground">
              {probeState.result.hasAudio ? "Detected" : "None detected"}
            </dd>
          </div>
        </dl>
      );
      break;
    }
  }

  useEffect(() => {
    setIsConverterReady(true);
  }, []);

  useEffect(() => {
    if (!source) {
      setProbeState({ status: "idle" });
      return;
    }

    let cancelled = false;

    setProbeState({ status: "loading" });
    setProgress(0);
    setExportError(null);

    probeSource(source)
      .then((result) => {
        if (!cancelled) {
          setProbeState({ status: "ready", result });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setProbeState({ status: "error", message: probeErrorMessage(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [source, sourceProbeKey]);

  useEffect(() => {
    setOutputNameStem(
      sourceFile
        ? buildConvertedFileBaseName(sourceFile.name)
        : "converted-video",
    );
  }, [sourceFile, sourceProbeKey]);

  const selectFile = useCallback(
    (file: File | null | undefined) => {
      if (!file || !canSelectFile) {
        return;
      }

      setSource(buildLocalFileSource(file));
    },
    [canSelectFile],
  );

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      selectFile(event.currentTarget.files?.item(0));
      event.currentTarget.value = "";
    },
    [selectFile],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setDragActive(false);
      if (!canSelectFile) {
        return;
      }
      selectFile(event.dataTransfer.files.item(0));
    },
    [canSelectFile, selectFile],
  );

  const handleOutputNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setOutputNameStem(event.currentTarget.value);
      setExportError(null);
    },
    [],
  );

  const handleFormatChange = useCallback((nextFormat: ExportFormat) => {
    setFormat(nextFormat);
    setExportError(null);
  }, []);

  const handleQualityChange = useCallback(
    (quality: ExportQualityPreset) => {
      if (format === "gif") {
        setGifPreset(quality);
      } else if (isVideoExportQuality(quality)) {
        setVideoQuality(quality);
      }

      setExportError(null);
    },
    [format],
  );

  const applyQuickTemplate = useCallback((templateId: QuickTemplate["id"]) => {
    switch (templateId) {
      case "gif-from-video": {
        setFormat("gif");
        setGifPreset(DEFAULT_GIF_EXPORT_PRESET);
        setResolution("720");
        setIncludeAudio(false);
        break;
      }
      case "webm-for-web": {
        setFormat("webm");
        setVideoQuality("compact");
        setResolution("720");
        setIncludeAudio(false);
        break;
      }
      case "mp4-high-quality": {
        setFormat("mp4");
        setVideoQuality("sharp");
        setResolution("1080");
        setIncludeAudio(true);
        break;
      }
      case "mpeg-ts-to-mp4": {
        setFormat("mp4");
        setVideoQuality("sharp");
        setResolution("original");
        setIncludeAudio(true);
        break;
      }
      case "mkv-to-mp4": {
        setFormat("mp4");
        setVideoQuality("sharp");
        setResolution("original");
        setIncludeAudio(true);
        break;
      }
      case "compress-video": {
        setFormat("mp4");
        setVideoQuality("compact");
        setResolution("720");
        setIncludeAudio(true);
        break;
      }
      default: {
        break;
      }
    }

    setExportError(null);
  }, []);

  const handleExport = useCallback(async () => {
    if (!source || !sourceFile || !probeResult || exportDisabledReason) {
      return;
    }

    setExporting(true);
    setProgress(0);
    setExportError(null);

    try {
      await runConvertExport({
        source,
        fileName: outputFileName,
        probe: probeResult,
        format,
        resolution,
        gifSettings: format === "gif" ? gifSettings : undefined,
        videoQuality: format === "gif" ? undefined : videoQuality,
        includeAudio: effectiveIncludeAudio,
        onProgress: (nextProgress) => {
          setProgress((currentProgress: number) =>
            nextProgress >= 1 ||
            Math.round(nextProgress * 100) !== Math.round(currentProgress * 100)
              ? nextProgress
              : currentProgress,
          );
        },
      });

      setProgress(1);
    } catch (error) {
      setExportError(errorMessage(error, "Conversion failed."));
    } finally {
      setExporting(false);
    }
  }, [
    effectiveIncludeAudio,
    exportDisabledReason,
    format,
    gifSettings,
    outputFileName,
    probeResult,
    resolution,
    source,
    sourceFile,
    videoQuality,
  ]);

  let sourcePickerContent: ReactNode;
  if (source && probeResult) {
    sourcePickerContent = (
      <MediabunnySourcePreview
        source={source}
        sourceKey={sourceProbeKey}
        probe={probeResult}
        canSelectFile={canSelectFile}
        dragActive={dragActive}
        onDragActiveChange={setDragActive}
        onDropFile={selectFile}
      />
    );
  } else if (source) {
    sourcePickerContent = (
      <div
        className={`mt-4 flex aspect-video items-center justify-center rounded-lg border border-border bg-background text-sm font-medium text-muted-foreground transition-colors ${
          dragActive ? "border-secondary bg-secondary/10" : ""
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          if (canSelectFile) {
            setDragActive(true);
          }
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          if (canSelectFile) {
            selectFile(event.dataTransfer.files.item(0));
          }
        }}
      >
        Preparing preview
      </div>
    );
  } else {
    sourcePickerContent = (
      <label
        htmlFor={canSelectFile ? fileInputId : undefined}
        onDragOver={(event) => {
          event.preventDefault();
          if (canSelectFile) {
            setDragActive(true);
          }
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`mt-4 flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center transition-colors ${
          dragActive
            ? "border-secondary bg-secondary/10"
            : "border-border bg-background"
        } ${canSelectFile ? "cursor-pointer" : "cursor-wait"}`}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
          <Upload className="h-5 w-5" />
        </div>

        <div className="mt-4 max-w-sm space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {emptyDropZoneTitle}
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            {emptyDropZoneDescription}
          </p>
        </div>

        <span
          aria-hidden="true"
          className={`mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors ${
            isConverterReady
              ? "bg-foreground text-background hover:bg-primary"
              : "bg-muted text-muted-foreground"
          }`}
        >
          <FolderOpen className="h-4 w-4" />
          {isConverterReady ? "Choose File" : "Preparing"}
        </span>
      </label>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Source</h2>
            </div>
            {sourceFile ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={!canSelectFile}
                className="focus-ring inline-flex h-9 items-center justify-center gap-2 rounded-full border border-border bg-background px-3 text-sm font-semibold text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCcw className="h-4 w-4" />
                Replace
              </button>
            ) : null}
          </div>

          <input
            id={fileInputId}
            ref={inputRef}
            type="file"
            accept={fileAccept}
            className="sr-only"
            disabled={!canSelectFile}
            onChange={handleFileChange}
          />

          {sourcePickerContent}

          <div className="mt-4 rounded-lg border border-border bg-background p-4">
            {sourceProbeContent}
          </div>

          {sourceFile ? (
            <label
              htmlFor={outputNameInputId}
              className="mt-4 block space-y-1.5"
            >
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                Output Name
              </span>
              <div className="flex min-h-10 overflow-hidden rounded-md border border-border bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50">
                <input
                  id={outputNameInputId}
                  type="text"
                  value={outputNameStem}
                  disabled={exporting}
                  onChange={handleOutputNameChange}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60"
                />
                <span className="flex items-center border-l border-border bg-card px-3 font-mono text-xs text-muted-foreground">
                  {selectedFormatOption.extension}
                </span>
              </div>
            </label>
          ) : null}
        </section>

        <section
          aria-label="Conversion settings"
          className="overflow-hidden rounded-lg border border-border bg-card"
        >
          <TooltipProvider>
            <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-editor-export">
              <div className="space-y-4">
                {exportError ? (
                  <div className={destructiveAlertClasses}>{exportError}</div>
                ) : null}

                {formatDisabledReason ? (
                  <div className={primaryAlertClasses}>
                    {formatDisabledReason}
                  </div>
                ) : null}

                <EditorExportSettingsSection
                  selectedFormat={format}
                  onFormatChange={handleFormatChange}
                  selectedQuality={selectedQuality}
                  onQualityChange={handleQualityChange}
                  selectedResolution={resolution}
                  onResolutionChange={setResolution}
                  includeAudio={effectiveIncludeAudio}
                  onIncludeAudioChange={setIncludeAudio}
                  audioDisabledReason={audioDisabledReason}
                  showSourcePreference={false}
                />
              </div>

              <EditorExportSummaryPanel
                title={sourceTitle}
                clipStart={0}
                clipEnd={probeResult?.durationSeconds ?? 0}
                selectedFormat={format}
                selectedQuality={selectedQuality}
                gifSettings={format === "gif" ? gifSettings : null}
                outputDimensions={outputDimensions}
                includeAudio={effectiveIncludeAudio}
                showClipSummary={false}
                showSourceSummary={false}
                showSubtitleSummary={false}
                showFilenameSummary={false}
              />
            </div>
          </TooltipProvider>

          <div className="flex flex-col gap-3 border-t border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 self-stretch sm:self-center">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                <span className="text-muted-foreground">Estimated size</span>
                <span className="font-mono tabular-nums text-foreground">
                  {outputEstimateLabel}
                </span>
              </div>
              {exportDisabledReason ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  {exportDisabledReason}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exporting || Boolean(exportDisabledReason)}
              className={`${compactPrimaryButtonClasses} w-44`}
            >
              {exporting ? (
                <>
                  <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                  <span>Converting</span>
                  <span className="inline-block w-[4ch] text-right font-mono tabular-nums">
                    {Math.round(progress * 100)}%
                  </span>
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Convert {selectedFormatOption.label}
                </>
              )}
            </button>
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-border/60 bg-muted/20 p-4 sm:p-5">
        <div className="mb-3">
          <h3 className="text-base font-semibold text-foreground">
            Quick templates
          </h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Click a template to prefill export settings.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quickTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              aria-label={`Apply quick template: ${template.title}`}
              onClick={() => applyQuickTemplate(template.id)}
              disabled={exporting}
              className="focus-ring cursor-pointer rounded-md border border-border/70 bg-background/70 px-3 py-3 text-left transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-60"
            >
              <p className="text-sm font-semibold text-foreground">
                {template.title}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {template.description}
              </p>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
