import {
  useExportSettings,
  useExportAudioPlan,
  useExportVideoPlan,
  exportIncludesAudio,
  isAudioExportFormat,
  DEFAULT_GIF_EXPORT_PRESET,
  ExportStatusPanel,
  EditorExportSettingsSection,
  EditorExportSummaryPanel,
  TooltipProvider,
  compactPrimaryButtonClasses,
  estimateExportOutputSize,
  exportFormatDurationDisabledReason,
  formatCanCopyVideoCodec,
  exportFormatFor,
  resolveExportOutputDimensions,
  titleFromFileName,
  type EditorFileMediaSource,
  type ExportVideoEncodingPlan,
  type ExportPhase,
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
  runConvertExport,
  probeConvertSource,
  type SourceProbeResult,
} from "@/components/convert/convertToolUtilities";
import {
  flushConvertMetrics,
  recordConvertExportCompleted,
  recordConvertExportFailed,
  recordConvertExportStarted,
} from "@/components/convert/convertMetrics";
import { MediabunnySourcePreview } from "@/components/convert/MediabunnySourcePreview";

type ProbeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; result: SourceProbeResult }
  | { status: "error"; message: string };

const fileAccept = [
  "video/*",
  "audio/*",
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".flac",
  ".wav",
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

function dimensionsLabel(result: SourceProbeResult | null) {
  return result?.dimensions
    ? `${result.dimensions.width} x ${result.dimensions.height}`
    : "Unknown";
}

function fileTypeLabel(file: File | null) {
  if (!file) {
    return "Unknown";
  }

  const extension = /(?:\.([^.]+))$/.exec(file.name)?.[1]?.toUpperCase();
  const mimeType = file.type.trim();

  if (extension && mimeType) {
    return `${extension} (${mimeType})`;
  }

  return mimeType || extension || "Unknown";
}

function probeErrorMessage(error: unknown) {
  return errorMessage(
    error,
    "Could not inspect this file. Try another media format.",
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

export function ConvertTool() {
  const fileInputId = useId();
  const outputNameInputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const exportController = useRef<AbortController | null>(null);
  const [source, setSource] = useState<EditorFileMediaSource | null>(null);
  const [probeCache, setProbeCache] = useState<{
    file: File;
    results: Partial<Record<"audio" | "video", SourceProbeResult>>;
  } | null>(null);
  const [probeError, setProbeError] = useState<{
    file: File;
    audioOnly: boolean;
    message: string;
  } | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const handleSettingsChange = useCallback(() => {
    setExportError(null);
    setExportNotice(null);
  }, []);
  const {
    mode,
    format,
    setOutputType,
    setVideoMuted,
    setFormat,
    resolution,
    setResolution,
    selectedQuality,
    setQuality,
    videoQuality,
    gifSettings,
    mixDownToStereo,
    setMixDownToStereo,
  } = useExportSettings(handleSettingsChange);
  const [outputNameStem, setOutputNameStem] = useState("converted-video");
  const [isConverterReady, setIsConverterReady] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportPhase, setExportPhase] = useState<ExportPhase>("preparing");
  const [progress, setProgress] = useState(0);

  const sourceFile = source?.file ?? null;
  const canSelectFile = isConverterReady && !exporting;
  const audioOnly = mode === "audio-only";
  const probeResult =
    probeCache?.file === sourceFile
      ? (probeCache?.results[audioOnly ? "audio" : "video"] ?? null)
      : null;
  let probeState: ProbeState = { status: sourceFile ? "loading" : "idle" };
  if (probeResult) {
    probeState = { status: "ready", result: probeResult };
  } else if (
    probeError?.file === sourceFile &&
    probeError?.audioOnly === audioOnly
  ) {
    probeState = { status: "error", message: probeError.message };
  }
  // Output selection does not change the inspected source or its preview.
  const sourceInspection =
    probeCache?.file === sourceFile
      ? (probeCache?.results.video ?? probeCache?.results.audio ?? null)
      : null;
  const sourceProbeState: ProbeState = sourceInspection
    ? { status: "ready", result: sourceInspection }
    : probeState;
  const sourceTitle = sourceFile
    ? titleFromFileName(sourceFile.name)
    : "No file selected";
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
  const effectiveIncludeAudio = exportIncludesAudio(mode, format);
  const audio = useExportAudioPlan(
    source,
    undefined,
    format,
    mixDownToStereo,
    effectiveIncludeAudio && Boolean(probeResult),
  );
  const resolvedVideoPlan = useExportVideoPlan(
    format,
    outputDimensions,
    videoQuality,
  );
  const sourceCopyEligible =
    !isAudioExportFormat(format) &&
    format !== "gif" &&
    videoQuality === "sharp" &&
    resolution === "original" &&
    formatCanCopyVideoCodec(format, probeResult?.videoCodec);
  const outputSizeEstimate = useMemo(() => {
    if (!probeResult || !sourceFile) {
      return { bytes: null, basis: "unavailable" as const };
    }
    return estimateExportOutputSize({
      format,
      durationSeconds: probeResult.durationSeconds,
      outputDimensions,
      mode,
      audioPlan: audio.plan,
      resolution,
      gifSettings: format === "gif" ? gifSettings : null,
      videoBitrateKbps: probeResult.videoBitrateKbps,
      sourceCopyEligible,
      preferredVideoCodec: resolvedVideoPlan?.codec ?? null,
      videoQuality: format === "gif" ? null : videoQuality,
    });
  }, [
    mode,
    audio.plan,
    format,
    gifSettings,
    outputDimensions,
    probeResult,
    resolution,
    resolvedVideoPlan,
    sourceCopyEligible,
    sourceFile,
    videoQuality,
  ]);
  const formatDisabledReason = probeResult
    ? exportFormatDurationDisabledReason(format, 0, probeResult.durationSeconds)
    : null;
  let exportDisabledReason = formatDisabledReason ?? audio.disabledReason;
  if (probeResult && !audioOnly && !probeResult.hasVideo) {
    exportDisabledReason =
      "This file contains only audio. Choose Audio to export it.";
  }
  if (!source || !probeResult) {
    exportDisabledReason = "Choose a file.";
  }
  if (probeState.status === "error") {
    exportDisabledReason = probeState.message;
  }
  if (probeState.status === "loading") {
    exportDisabledReason = "Inspecting file.";
  }
  const outputFileName = buildConvertedOutputFileName(outputNameStem, format);
  const selectedFormatOption = exportFormatFor(format);
  const emptyDropZoneTitle = isConverterReady
    ? "Drop a video or audio file here"
    : "Preparing converter";
  const emptyDropZoneDescription = isConverterReady
    ? "MP4, MOV, MKV, WebM, MPEG-TS, MP3, M4A, Ogg, FLAC, and WAV are supported."
    : "The file picker will be ready in a moment.";
  let sourceProbeContent: ReactNode;
  switch (sourceProbeState.status) {
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
        <p className="text-sm text-destructive">{sourceProbeState.message}</p>
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
              {formatDuration(sourceProbeState.result.durationSeconds)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              Dimensions
            </dt>
            <dd className="mt-1 font-mono text-sm text-foreground">
              {dimensionsLabel(sourceProbeState.result)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              Type
            </dt>
            <dd className="mt-1 font-mono text-sm text-foreground">
              {fileTypeLabel(sourceFile)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              Audio
            </dt>
            <dd className="mt-1 text-sm text-foreground">
              {sourceProbeState.result.hasAudio ? "Detected" : "None detected"}
            </dd>
          </div>
        </dl>
      );
      break;
    }
  }

  useEffect(() => {
    setIsConverterReady(true);
    return () => {
      exportController.current?.abort();
      exportController.current = null;
    };
  }, []);

  useEffect(() => {
    setProgress(0);
    setExportError(null);
    setProbeError(null);
    setExportNotice(null);
    if (!source || probeResult) {
      return;
    }

    const controller = new AbortController();

    probeConvertSource(source, audioOnly, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          if (
            probeCache?.file !== source.file &&
            !result.hasVideo &&
            result.hasAudio
          ) {
            setOutputType("audio");
          }
          // Retain only completed results for one file; never cache live inputs.
          setProbeCache((previous) => ({
            file: source.file,
            results: {
              ...(previous?.file === source.file ? previous.results : {}),
              ...(result.hasVideo
                ? { [audioOnly ? "audio" : "video"]: result }
                : { audio: result, video: result }),
            },
          }));
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setProbeError({
            file: source.file,
            audioOnly,
            message: probeErrorMessage(error),
          });
        }
      });

    return () => {
      controller.abort();
    };
  }, [source, audioOnly, probeResult, probeCache?.file, setOutputType]);

  useEffect(() => {
    setOutputNameStem(
      sourceFile
        ? buildConvertedFileBaseName(sourceFile.name)
        : "converted-video",
    );
  }, [sourceFile]);

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
      handleSettingsChange();
    },
    [handleSettingsChange],
  );

  const applyQuickTemplate = useCallback(
    (templateId: QuickTemplate["id"]) => {
      switch (templateId) {
        case "gif-from-video": {
          setFormat("gif");
          setQuality(DEFAULT_GIF_EXPORT_PRESET);
          break;
        }
        case "webm-for-web": {
          setFormat("webm");
          setQuality("compact");
          setResolution("720");
          setVideoMuted(true);
          break;
        }
        case "mp4-high-quality": {
          setFormat("mp4");
          setQuality("sharp");
          setResolution("1080");
          setVideoMuted(false);
          break;
        }
        case "mpeg-ts-to-mp4": {
          setFormat("mp4");
          setQuality("sharp");
          setResolution("original");
          setVideoMuted(false);
          break;
        }
        case "mkv-to-mp4": {
          setFormat("mp4");
          setQuality("sharp");
          setResolution("original");
          setVideoMuted(false);
          break;
        }
        case "compress-video": {
          setFormat("mp4");
          setQuality("compact");
          setResolution("720");
          setVideoMuted(false);
          break;
        }
        default: {
          break;
        }
      }
    },
    [setFormat, setQuality, setResolution, setVideoMuted],
  );

  const handleExport = useCallback(async () => {
    if (
      !source ||
      !sourceFile ||
      !probeResult ||
      exportDisabledReason ||
      exportController.current
    ) {
      return;
    }

    const controller = new AbortController();
    exportController.current = controller;
    const isCurrent = () => exportController.current === controller;
    setExporting(true);
    setExportPhase("preparing");
    setExportNotice(null);
    setProgress(0);
    setExportError(null);

    const startedAt = Date.now();
    const metricContext = {
      sourceFile,
      probe: probeResult,
      format,
      selectedQuality,
      resolution,
      includeAudio: effectiveIncludeAudio,
      outputDimensions,
      outputSizeEstimate,
      gifSettings: format === "gif" ? gifSettings : null,
    };

    recordConvertExportStarted(metricContext);
    let videoEncodingPlan: ExportVideoEncodingPlan | undefined;

    try {
      const blob = await runConvertExport({
        signal: controller.signal,
        onPhaseChange: (phase) => {
          if (isCurrent() && !controller.signal.aborted) {
            setExportPhase(phase);
          }
        },
        source,
        fileName: outputFileName,
        probe: probeResult,
        format,
        resolution,
        gifSettings: format === "gif" ? gifSettings : undefined,
        videoQuality: format === "gif" ? undefined : videoQuality,
        mode,
        mixDownToStereo,
        audioPlan: audio.plan ?? undefined,
        onVideoEncodingPlan: (plan) => {
          videoEncodingPlan = plan;
        },
        onProgress: (nextProgress) => {
          if (!isCurrent() || controller.signal.aborted) {
            return;
          }
          setProgress((currentProgress: number) =>
            nextProgress >= 1 ||
            Math.round(nextProgress * 100) !== Math.round(currentProgress * 100)
              ? nextProgress
              : currentProgress,
          );
        },
      });

      if (!isCurrent()) {
        return;
      }
      recordConvertExportCompleted({
        ...metricContext,
        actualBytes: blob.size,
        durationMs: Math.max(0, Date.now() - startedAt),
        videoEncodingPlan,
      });
      void flushConvertMetrics();
      setProgress(1);
      setExportNotice(`Download started: ${outputFileName}`);
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      if (controller.signal.aborted) {
        setExportNotice("Export cancelled.");
        setProgress(0);
        return;
      }
      recordConvertExportFailed({
        ...metricContext,
        durationMs: Math.max(0, Date.now() - startedAt),
        videoEncodingPlan,
      });
      void flushConvertMetrics();
      setExportError(errorMessage(error, "Conversion failed."));
    } finally {
      if (isCurrent()) {
        exportController.current = null;
        setExporting(false);
      }
    }
  }, [
    effectiveIncludeAudio,
    mode,
    mixDownToStereo,
    audio.plan,
    exportDisabledReason,
    format,
    gifSettings,
    outputFileName,
    outputDimensions,
    outputSizeEstimate,
    probeResult,
    resolution,
    selectedQuality,
    source,
    sourceFile,
    videoQuality,
  ]);

  let sourcePickerContent: ReactNode;
  if (source && sourceInspection?.hasVideo && sourceInspection.dimensions) {
    sourcePickerContent = (
      <MediabunnySourcePreview
        source={source}
        probe={sourceInspection}
        canSelectFile={canSelectFile}
        dragActive={dragActive}
        onDragActiveChange={setDragActive}
        onDropFile={selectFile}
      />
    );
  } else if (source) {
    let previewMessage = "Preparing preview";
    if (probeResult) {
      previewMessage = audioOnly
        ? "Audio ready for export"
        : "Audio file selected";
    }
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
        {previewMessage}
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
          className="self-start overflow-hidden rounded-lg border border-border bg-card"
        >
          <TooltipProvider>
            <div className="grid h-[min(40rem,80svh)] content-start gap-4 overflow-y-auto p-4 lg:h-[28rem] lg:grid-cols-editor-export">
              <div className="space-y-4">
                <fieldset
                  disabled={exporting}
                  inert={exporting}
                  className="min-w-0 disabled:opacity-60"
                >
                  <EditorExportSettingsSection
                    selectedFormat={format}
                    onFormatChange={setFormat}
                    selectedQuality={selectedQuality}
                    onQualityChange={setQuality}
                    outputDimensions={outputDimensions}
                    selectedResolution={resolution}
                    onResolutionChange={setResolution}
                    mode={mode}
                    onOutputTypeChange={setOutputType}
                    onVideoMutedChange={setVideoMuted}
                    mixDownToStereo={mixDownToStereo}
                    onMixDownToStereoChange={setMixDownToStereo}
                    audioDisabledReason={audio.mixdownDisabledReason}
                    audioBitDepth={audio.bitDepth}
                    showSourcePreference={false}
                  />
                </fieldset>
              </div>

              <EditorExportSummaryPanel
                title={sourceTitle}
                clipStart={0}
                clipEnd={probeResult?.durationSeconds ?? 0}
                selectedFormat={format}
                selectedQuality={selectedQuality}
                gifSettings={format === "gif" ? gifSettings : null}
                outputDimensions={outputDimensions}
                mode={mode}
                audioSummary={audio.summary}
                showClipSummary={false}
                showSourceSummary={false}
                showSubtitleSummary={false}
                showFilenameSummary={false}
              />
            </div>
          </TooltipProvider>

          <div className="flex flex-col gap-3 border-t border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <ExportStatusPanel
              estimate={outputSizeEstimate}
              exporting={exporting}
              phase={exportPhase}
              progress={progress}
              notice={exportNotice}
              error={exportError}
              disabledReason={exportDisabledReason}
            />

            <div className="flex min-w-0 items-center gap-2 sm:shrink-0">
              <button
                type="button"
                onClick={() => exportController.current?.abort()}
                disabled={!exporting}
                className={`h-8 w-16 shrink-0 rounded-md border border-border text-xs font-medium ${exporting ? "" : "invisible"}`}
                aria-label="Cancel export"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={exporting || Boolean(exportDisabledReason)}
                className={`${compactPrimaryButtonClasses} w-44 min-w-0 whitespace-nowrap`}
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
                    Convert {format.toUpperCase()}
                  </>
                )}
              </button>
            </div>
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
