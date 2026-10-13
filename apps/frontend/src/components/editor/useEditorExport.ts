import {
  logDurationFields,
  logErrorFields,
  logEventFields,
} from "@cliparr/shared/logging";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type EditorMediaSource,
  type EditorSession,
  type MediaDimensions,
} from "@/components/editor/editorMedia";
import type { EditorExportMedia } from "@/components/editor/editorMediaLifecycle";
import type { PlaybackFallbackInfo } from "@/components/editor/editorPlaybackSources";
import { downloadBlob } from "@/lib/downloadBlob";
import type {
  ExportPhase,
  ExportVideoEncodingPlan,
} from "@/lib/export/exportClip";
import { formatCanCopyVideoCodec } from "@/lib/export/exportEncodingPolicy";
import {
  buildExportFileName,
  defaultExportFileNameTemplates,
  type ExportFileNameTemplateKind,
  type ExportFileNameTemplateSettings,
  loadExportFileNameTemplates,
  saveExportFileNameTemplates,
} from "@/lib/export/exportFileName";
import {
  DEFAULT_VIDEO_EXPORT_QUALITY,
  estimateExportOutputSize,
  exportFormatDurationDisabledReason,
  type ExportSourcePreference,
} from "@/lib/export/exportTypes";
import {
  fetchHlsExportEstimateMetadata,
  type HlsExportEstimateMetadata,
} from "@/lib/export/hlsExportEstimate";
import type { SubtitleCue, SubtitleStyleSettings } from "@/lib/subtitles/types";
import { getFrontendLogger, warnWithError } from "@/logging";
import {
  buildExportErrorMessage,
  buildExportEstimateActualLogFields,
  buildExportEstimateLogFields,
  buildExportSourceLabel,
  buildExportSourceMessage,
  buildExportSourceSummaryMessage,
  buildExportVideoEncodingLogFields,
  exportSourceSizeBytes,
  exportTimelineOffsetForSource,
  getEditorExportReadiness,
  getOutputDimensions,
  resolveExportSource,
} from "#/components/editor/editorExportPlan";
import { useExportAudioPlan } from "#/components/editor/useExportAudioPlan";
import { useExportSettings } from "#/components/editor/useExportSettings";
import { useExportVideoPlan } from "#/components/editor/useExportVideoPlan";
import type { ExportAudioPlan } from "#/lib/export/exportAudio";
import {
  exportIncludesAudio,
  isAudioExportFormat,
} from "#/lib/export/exportFormats";

interface UseEditorExportProperties {
  session: EditorSession;
  exportMedia: EditorExportMedia | null;
  startTime: number;
  endTime: number;
  sourceVideoDimensions: MediaDimensions | null;
  exportFallbackSource?: EditorMediaSource;
  hlsFallbackInfo: PlaybackFallbackInfo | null;
  subtitleEnabled: boolean;
  clippedSubtitleCues: readonly SubtitleCue[];
  subtitleLoading: boolean;
  subtitleCues: readonly SubtitleCue[];
  subtitleStyleSettings: SubtitleStyleSettings;
}

const logger = getFrontendLogger(["editor", "export"]);

export function useEditorExport({
  session,
  exportMedia,
  startTime,
  endTime,
  sourceVideoDimensions,
  exportFallbackSource,
  hlsFallbackInfo,
  subtitleEnabled,
  clippedSubtitleCues,
  subtitleLoading,
  subtitleCues,
  subtitleStyleSettings,
}: UseEditorExportProperties) {
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [hlsEstimateMetadata, setHlsEstimateMetadata] =
    useState<HlsExportEstimateMetadata | null>(null);
  const handleSettingsChange = useCallback(() => {
    setExportError(null);
    setExportNotice(null);
  }, []);
  const {
    mode,
    format: exportFormat,
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
  const [exportSourcePreference, setExportSourcePreference] =
    useState<ExportSourcePreference>("auto");
  const [fileNameTemplates, setFileNameTemplates] =
    useState<ExportFileNameTemplateSettings>(() =>
      loadExportFileNameTemplates(),
    );
  const [templateEditorKind, setTemplateEditorKind] =
    useState<ExportFileNameTemplateKind>("movie");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportPhase, setExportPhase] = useState<ExportPhase>("preparing");
  const exportController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      exportController.current?.abort();
    };
  }, []);
  const handleCancelExport = useCallback(() => {
    exportController.current?.abort();
  }, []);
  const exportLogger = useMemo(
    () => logger.with({ "editor.session.id": session.id }),
    [session.id],
  );
  const effectiveIncludeAudio = exportIncludesAudio(mode, exportFormat);

  let effectiveExportSourcePreference = exportSourcePreference;
  if (
    (exportSourcePreference === "direct" && !session.directSource) ||
    (exportSourcePreference === "hls" && !session.hlsSource)
  ) {
    effectiveExportSourcePreference = "auto";
  }

  const exportSource = useMemo(
    () =>
      resolveExportSource({
        preference: effectiveExportSourcePreference,
        hlsSource: session.hlsSource,
        directSource: session.directSource,
        exportFallbackSource,
      }),
    [
      effectiveExportSourcePreference,
      exportFallbackSource,
      session.directSource,
      session.hlsSource,
    ],
  );

  const audio = useExportAudioPlan(
    exportSource.source,
    session.selectedAudioTrack,
    exportFormat,
    mixDownToStereo,
    exportDialogOpen && effectiveIncludeAudio,
  );

  const exportSourceMessage = useMemo(
    () =>
      buildExportSourceMessage({
        preference: effectiveExportSourcePreference,
        resolvedSourceKind: exportSource.kind,
        resolvedSource: exportSource.source,
        hlsSource: session.hlsSource,
        directSource: session.directSource,
        hlsFallbackInfo,
      }),
    [
      effectiveExportSourcePreference,
      exportSource.kind,
      exportSource.source,
      hlsFallbackInfo,
      session.directSource,
      session.hlsSource,
    ],
  );

  const exportSourceSummaryMessage = useMemo(
    () =>
      buildExportSourceSummaryMessage({
        preference: effectiveExportSourcePreference,
        resolvedSourceKind: exportSource.kind,
        resolvedSource: exportSource.source,
        hlsSource: session.hlsSource,
      }),
    [
      effectiveExportSourcePreference,
      exportSource.kind,
      exportSource.source,
      session.hlsSource,
    ],
  );

  const exportSourceLabel = useMemo(
    () =>
      buildExportSourceLabel({
        preference: effectiveExportSourcePreference,
        resolvedSourceKind: exportSource.kind,
        resolvedSource: exportSource.source,
        exportFallbackSource,
      }),
    [
      effectiveExportSourcePreference,
      exportFallbackSource,
      exportSource.kind,
      exportSource.source,
    ],
  );

  const fileName = useMemo(
    () =>
      buildExportFileName({
        title: session.title,
        sessionType: session.type,
        metadata: session.exportMetadata,
        startTime,
        endTime,
        format: exportFormat,
        templates: fileNameTemplates,
      }),
    [
      endTime,
      exportFormat,
      fileNameTemplates,
      session.exportMetadata,
      session.title,
      session.type,
      startTime,
    ],
  );

  const outputDimensions = useMemo(
    () =>
      getOutputDimensions(
        sourceVideoDimensions,
        resolution,
        exportFormat,
        exportFormat === "gif" ? gifSettings : undefined,
      ),
    [exportFormat, gifSettings, resolution, sourceVideoDimensions],
  );
  const resolvedVideoPlan = useExportVideoPlan(
    exportFormat,
    outputDimensions,
    videoQuality,
  );

  const shouldEstimateBurnedSubtitles =
    subtitleEnabled && !subtitleLoading && clippedSubtitleCues.length > 0;
  const sourceSizeBytes =
    exportSource.kind === "direct"
      ? (exportSourceSizeBytes(exportSource.source) ??
        session.exportEstimateMetadata?.sourceSizeBytes)
      : null;
  const sourceDurationSeconds =
    exportSource.kind === "direct"
      ? (session.exportEstimateMetadata?.sourceDurationSeconds ??
        session.duration)
      : session.duration;
  const sourceBitrateKbps =
    exportSource.kind === "none"
      ? null
      : session.exportEstimateMetadata?.sourceBitrateKbps;
  const videoBitrateKbps =
    exportSource.kind === "none"
      ? null
      : session.exportEstimateMetadata?.videoBitrateKbps;
  const audioBitrateKbps =
    exportSource.kind === "none"
      ? null
      : session.exportEstimateMetadata?.audioBitrateKbps;
  const estimateSourceBitrateKbps =
    exportSource.kind === "direct" ? sourceBitrateKbps : null;
  const estimateVideoBitrateKbps =
    exportSource.kind === "direct" ? videoBitrateKbps : null;
  const estimateAudioBitrateKbps =
    exportSource.kind === "none" ? null : audioBitrateKbps;
  const sourceCopyEligible =
    !isAudioExportFormat(exportFormat) &&
    exportFormat !== "gif" &&
    exportSource.kind === "direct" &&
    startTime === 0 &&
    formatCanCopyVideoCodec(
      exportFormat,
      session.exportEstimateMetadata?.videoCodec,
    );
  const outputSizeEstimate = useMemo(() => {
    return estimateExportOutputSize({
      format: exportFormat,
      durationSeconds: Math.max(0, endTime - startTime),
      outputDimensions,
      mode,
      audioPlan: audio.plan,
      resolution,
      gifSettings: exportFormat === "gif" ? gifSettings : null,
      sourceSizeBytes,
      sourceDurationSeconds,
      sourceBitrateKbps: estimateSourceBitrateKbps,
      videoBitrateKbps: estimateVideoBitrateKbps,
      audioBitrateKbps: estimateAudioBitrateKbps,
      sourceCopyEligible,
      preferredVideoCodec: resolvedVideoPlan?.codec ?? null,
      includeBurnedSubtitles: shouldEstimateBurnedSubtitles,
      videoQuality: exportFormat === "gif" ? null : videoQuality,
    });
  }, [
    mode,
    audio.plan,
    endTime,
    estimateAudioBitrateKbps,
    estimateSourceBitrateKbps,
    estimateVideoBitrateKbps,
    exportFormat,
    gifSettings,
    outputDimensions,
    resolution,
    resolvedVideoPlan,
    shouldEstimateBurnedSubtitles,
    sourceDurationSeconds,
    sourceSizeBytes,
    sourceCopyEligible,
    startTime,
    videoQuality,
  ]);

  const exportFormatDisabledReason = useMemo(
    () => exportFormatDurationDisabledReason(exportFormat, startTime, endTime),
    [endTime, exportFormat, startTime],
  );

  useEffect(() => {
    saveExportFileNameTemplates(fileNameTemplates);
  }, [fileNameTemplates]);

  useEffect(() => {
    setHlsEstimateMetadata(null);

    if (
      !exportDialogOpen ||
      isAudioExportFormat(exportFormat) ||
      exportFormat === "gif" ||
      videoQuality !== DEFAULT_VIDEO_EXPORT_QUALITY ||
      exportSource.kind !== "hls" ||
      exportSource.source?.kind !== "url"
    ) {
      return;
    }

    const controller = new AbortController();

    fetchHlsExportEstimateMetadata(
      exportSource.source.url,
      outputDimensions,
      controller.signal,
    )
      .then((metadata) => {
        if (!controller.signal.aborted) {
          setHlsEstimateMetadata(metadata);
        }
      })
      .catch((error: unknown) => {
        const isAbortError =
          error instanceof Error && error.name === "AbortError";
        if (!controller.signal.aborted && !isAbortError) {
          setHlsEstimateMetadata(null);
          warnWithError(
            exportLogger,
            error,
            "Could not fetch HLS export estimate metadata.",
            {
              ...logEventFields("editor.export.hls_estimate", "failure"),
              "export.format": exportFormat,
              "export.source.kind": exportSource.kind,
              "export.source.role": exportSource.source?.role,
              "export.output.width": outputDimensions?.width,
              "export.output.height": outputDimensions?.height,
            },
          );
        }
      });

    return () => {
      controller.abort();
    };
  }, [
    exportDialogOpen,
    exportLogger,
    exportFormat,
    exportSource.kind,
    exportSource.source,
    outputDimensions,
    videoQuality,
  ]);

  const handleOpenExportDialog = useCallback(() => {
    setExportError(null);
    setExportNotice(null);
    setHlsEstimateMetadata(null);
    setProgress(0);
    setTemplateEditorKind(fileName.templateKind);
    setExportDialogOpen(true);
  }, [fileName.templateKind]);

  const handleCloseExportDialog = useCallback(() => {
    if (exporting) {
      return;
    }

    setExportDialogOpen(false);
    setHlsEstimateMetadata(null);
  }, [exporting]);

  const handleExportSourceChange = useCallback(
    (nextSourcePreference: ExportSourcePreference) => {
      setExportSourcePreference(nextSourcePreference);
      handleSettingsChange();
    },
    [handleSettingsChange],
  );

  const handleFileNameTemplateChange = useCallback(
    (kind: ExportFileNameTemplateKind, nextTemplate: string) => {
      setFileNameTemplates((current) => ({
        ...current,
        [kind]: nextTemplate,
      }));
      handleSettingsChange();
    },
    [handleSettingsChange],
  );

  const handleResetFileNameTemplate = useCallback(
    (kind: ExportFileNameTemplateKind) => {
      const defaults = defaultExportFileNameTemplates();

      setFileNameTemplates((current) => ({
        ...current,
        [kind]: defaults[kind],
      }));
      handleSettingsChange();
    },
    [handleSettingsChange],
  );

  const handleExport = useCallback(async () => {
    if (exportController.current) {
      return;
    }
    const readiness = getEditorExportReadiness({
      exportSource,
      format: exportFormat,
      exporting,
      startTime,
      endTime,
      subtitleEnabled,
      clippedSubtitleCues,
      subtitleLoading,
    });

    if (readiness.state === "idle") {
      return;
    }

    if (readiness.state === "blocked") {
      setExportError(readiness.message);
      return;
    }

    if (audio.disabledReason) {
      setExportError(audio.disabledReason);
      return;
    }
    const shouldBurnSubtitles = readiness.shouldBurnSubtitles;

    setExportError(null);
    const controller = new AbortController();
    exportController.current = controller;
    setExportNotice(null);
    setExportPhase("preparing");
    setExporting(true);
    setProgress(0);

    const startedAt = Date.now();
    const estimateFields = buildExportEstimateLogFields({
      estimate: outputSizeEstimate,
      hlsEstimateMetadata,
      sourceSizeBytes,
      sourceDurationSeconds,
      sourceBitrateKbps,
      videoBitrateKbps,
      audioBitrateKbps,
    });
    const baseFields = {
      "export.format": exportFormat,
      "export.quality": selectedQuality,
      "export.resolution": resolution,
      "export.source.kind": readiness.sourceKind,
      "export.source.role": readiness.source.role,
      "export.range.start_seconds": startTime,
      "export.range.end_seconds": endTime,
      "export.range.duration_seconds": Math.max(0, endTime - startTime),
      "export.mode": mode,
      "export.audio.mix_down_to_stereo": mixDownToStereo,
      "export.subtitle.burn_in": shouldBurnSubtitles,
      "export.subtitle.cue_count": shouldBurnSubtitles
        ? clippedSubtitleCues.length
        : 0,
      "export.output.width": outputDimensions?.width,
      "export.output.height": outputDimensions?.height,
      ...estimateFields,
    };

    exportLogger.info("Editor export started.", {
      ...logEventFields("editor.export", "started"),
      ...baseFields,
    });
    let videoEncodingPlan: ExportVideoEncodingPlan | undefined;
    let audioEncodingPlan: ExportAudioPlan | undefined;

    try {
      const { exportClip } = await import("@/lib/export/exportClip");
      controller.signal.throwIfAborted();
      const handleProgress = (nextProgress: number) => {
        if (controller.signal.aborted || !mounted.current) {
          return;
        }
        setProgress((currentProgress) => {
          const nextPercent = Math.round(nextProgress * 100);
          const currentPercent = Math.round(currentProgress * 100);

          return nextProgress >= 1 || nextPercent !== currentPercent
            ? nextProgress
            : currentProgress;
        });
      };
      const blob = await exportClip({
        signal: controller.signal,
        onPhaseChange: (phase) => {
          if (mounted.current && !controller.signal.aborted) {
            setExportPhase(phase);
          }
        },
        mediaSource: readiness.source,
        timelineOffsetSeconds: exportTimelineOffsetForSource(
          readiness.source,
          exportMedia,
        ),
        hls: readiness.sourceKind === "hls",
        startTime,
        endTime,
        format: exportFormat,
        resolution,
        gifSettings: exportFormat === "gif" ? gifSettings : undefined,
        videoQuality: exportFormat === "gif" ? undefined : videoQuality,
        mode,
        mixDownToStereo,
        audioPlan: audio.plan ?? undefined,
        title: session.title,
        onAudioEncodingPlan: (plan) => {
          audioEncodingPlan = plan;
        },
        selectedAudioTrack: session.selectedAudioTrack,
        metadata: session.exportMetadata,
        includeBurnedSubtitles: shouldBurnSubtitles,
        subtitleCues,
        subtitleStyleSettings,
        onVideoEncodingPlan: (plan) => {
          videoEncodingPlan = plan;
        },
        onProgress: handleProgress,
      });
      controller.signal.throwIfAborted();
      downloadBlob(blob, fileName.fullName);
      setExportNotice(`Download started: ${fileName.fullName}`);

      exportLogger.info("Editor export completed.", {
        ...logEventFields("editor.export", "success"),
        ...logDurationFields(startedAt),
        ...baseFields,
        "export.output.bytes": blob.size,
        "export.encoder.audio.codec": audioEncodingPlan?.codec,
        "export.encoder.audio.sample_rate": audioEncodingPlan?.sampleRate,
        "export.encoder.audio.channels": audioEncodingPlan?.numberOfChannels,
        "export.encoder.audio.bits": audioEncodingPlan?.bits,
        "export.encoder.audio.bitrate": audioEncodingPlan?.bitrate,
        ...buildExportVideoEncodingLogFields(videoEncodingPlan),
        ...buildExportEstimateActualLogFields(outputSizeEstimate, blob.size),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        exportLogger.info("Editor export cancelled.", {
          ...logEventFields("editor.export", "cancelled"),
          ...logDurationFields(startedAt),
          ...baseFields,
        });
        if (mounted.current) {
          setExportNotice("Export cancelled. Your edits are unchanged.");
        }
        return;
      }
      warnWithError(exportLogger, error, "Editor export failed.", {
        ...logEventFields("editor.export", "failure"),
        ...logDurationFields(startedAt),
        ...logErrorFields(error),
        ...baseFields,
        ...buildExportVideoEncodingLogFields(videoEncodingPlan),
      });
      setExportError(
        buildExportErrorMessage(error, exportSource, session.hlsSource),
      );
    } finally {
      exportController.current = null;
      if (mounted.current) {
        setExporting(false);
      }
    }
  }, [
    clippedSubtitleCues,
    endTime,
    mode,
    mixDownToStereo,
    audio.plan,
    audio.disabledReason,
    session.title,
    session.hlsSource,
    exportFormat,
    exportLogger,
    exportSource,
    exporting,
    exportMedia,
    fileName.fullName,
    gifSettings,
    outputDimensions,
    outputSizeEstimate,
    resolution,
    selectedQuality,
    hlsEstimateMetadata,
    session.exportMetadata,
    session.selectedAudioTrack,
    sourceBitrateKbps,
    sourceDurationSeconds,
    sourceSizeBytes,
    startTime,
    videoQuality,
    videoBitrateKbps,
    audioBitrateKbps,
    subtitleCues,
    subtitleEnabled,
    subtitleLoading,
    subtitleStyleSettings,
  ]);

  return {
    resolution,
    exportFormat,
    selectedQuality,
    gifSettings,
    effectiveExportSourcePreference,
    mode,
    mixDownToStereo,
    setMixDownToStereo,
    audioStatus: audio.status,
    audioPlan: audio.plan,
    audioBitDepth: audio.bitDepth,
    audioExportDisabledReason: audio.disabledReason,
    audioDisabledReason: audio.mixdownDisabledReason,
    fileNameTemplates,
    templateEditorKind,
    setTemplateEditorKind,
    exportDialogOpen,
    exporting,
    progress,
    exportPhase,
    exportNotice,
    handleCancelExport,
    exportError,
    fileName,
    outputDimensions,
    outputSizeEstimate,
    exportFormatDisabledReason,
    exportSource,
    exportSourceMessage,
    exportSourceSummaryMessage,
    exportSourceLabel,
    handleOpenExportDialog,
    handleCloseExportDialog,
    handleFormatChange: setFormat,
    handleQualityChange: setQuality,
    handleResolutionChange: setResolution,
    handleExportSourceChange,
    handleOutputTypeChange: setOutputType,
    handleVideoMutedChange: setVideoMuted,
    handleFileNameTemplateChange,
    handleResetFileNameTemplate,
    handleExport,
  };
}
