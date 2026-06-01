import { useCallback, useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import { errorMessage } from "@/components/editor/editorUtils";
import type { EditorSession } from "@/lib/editorMedia";
import { downloadBlob } from "@/lib/downloadBlob";
import { buildFramegrabFileName } from "@/lib/exportFileName";
import {
  cloneCanvasFrame,
  copyFramegrabCanvasToClipboard,
  DEFAULT_FRAMEGRAB_IMAGE_QUALITY,
  encodeFramegrabCanvas,
  type FramegrabImageFormat,
  type FramegrabImageQuality,
} from "@/lib/framegrab";

interface VideoDimensions {
  width: number;
  height: number;
}

interface CapturedFramegrab {
  canvas: HTMLCanvasElement;
  time: number;
  dimensions: VideoDimensions;
}

type FramegrabAction = "copy" | "download";

interface UseEditorFramegrabProps {
  session: EditorSession;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  currentTime: number;
  loadingPreview: boolean;
  loadingPreviewFrame: boolean;
  previewVideoDimensions: VideoDimensions | null;
  subtitleEnabled: boolean;
  subtitleLoading: boolean;
  subtitleError: string | null;
  getCurrentTime?: () => number;
}

export function useEditorFramegrab({
  session,
  canvasRef,
  currentTime,
  loadingPreview,
  loadingPreviewFrame,
  previewVideoDimensions,
  subtitleEnabled,
  subtitleLoading,
  subtitleError,
  getCurrentTime,
}: UseEditorFramegrabProps) {
  const [dialogMounted, setDialogMounted] = useState(false);
  const [capturedFramegrab, setCapturedFramegrab] =
    useState<CapturedFramegrab | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [format, setFormat] = useState<FramegrabImageFormat>("png");
  const [quality, setQuality] = useState<FramegrabImageQuality>(
    DEFAULT_FRAMEGRAB_IMAGE_QUALITY,
  );
  const [action, setAction] = useState<FramegrabAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (dialogOpen) {
      setDialogMounted(true);
    }
  }, [dialogOpen]);

  const fileName = useMemo(
    () =>
      buildFramegrabFileName({
        title: session.title,
        sessionType: session.type,
        metadata: session.exportMetadata,
        frameTime: capturedFramegrab?.time ?? currentTime,
        format,
      }),
    [
      capturedFramegrab?.time,
      currentTime,
      format,
      session.exportMetadata,
      session.title,
      session.type,
    ],
  );

  const disabledReason = useMemo(() => {
    if (loadingPreview || loadingPreviewFrame) {
      return "Preview frame is loading.";
    }

    if (subtitleEnabled && subtitleLoading) {
      return "Subtitles are still loading.";
    }

    if (subtitleEnabled && subtitleError) {
      return subtitleError;
    }

    const canvas = canvasRef.current;
    if (
      !previewVideoDimensions ||
      !canvas ||
      canvas.width <= 0 ||
      canvas.height <= 0
    ) {
      return "No preview frame available.";
    }

    return null;
  }, [
    canvasRef,
    loadingPreview,
    loadingPreviewFrame,
    previewVideoDimensions,
    subtitleEnabled,
    subtitleError,
    subtitleLoading,
  ]);

  const openDialog = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      setCapturedFramegrab(null);
      setError("No preview frame is available yet.");
      setMessage(null);
      setDialogMounted(true);
      setDialogOpen(true);
      return;
    }

    try {
      const clonedCanvas = cloneCanvasFrame(canvas);
      const frameTime = getCurrentTime?.() ?? currentTime;
      setCapturedFramegrab({
        canvas: clonedCanvas,
        time: frameTime,
        dimensions: {
          width: clonedCanvas.width,
          height: clonedCanvas.height,
        },
      });
      setError(null);
      setMessage(null);
      setDialogOpen(true);
    } catch (err) {
      setCapturedFramegrab(null);
      setError(errorMessage(err));
      setMessage(null);
      setDialogMounted(true);
      setDialogOpen(true);
    }
  }, [canvasRef, currentTime, getCurrentTime]);

  const closeDialog = useCallback(() => {
    if (action) {
      return;
    }

    setDialogOpen(false);
    setCapturedFramegrab(null);
    setError(null);
    setMessage(null);
  }, [action]);

  const handleFormatChange = useCallback((nextFormat: FramegrabImageFormat) => {
    setFormat(nextFormat);
    setError(null);
    setMessage(null);
  }, []);

  const handleQualityChange = useCallback(
    (nextQuality: FramegrabImageQuality) => {
      setQuality(nextQuality);
      setError(null);
      setMessage(null);
    },
    [],
  );

  const copyFramegrab = useCallback(async () => {
    if (!capturedFramegrab || action) {
      return;
    }

    setAction("copy");
    setError(null);
    setMessage(null);

    try {
      await copyFramegrabCanvasToClipboard(capturedFramegrab.canvas);
      setMessage("Copied to clipboard.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAction(null);
    }
  }, [action, capturedFramegrab]);

  const downloadFramegrab = useCallback(async () => {
    if (!capturedFramegrab || action) {
      return;
    }

    setAction("download");
    setError(null);
    setMessage(null);

    try {
      const blob = await encodeFramegrabCanvas(
        capturedFramegrab.canvas,
        format,
        quality,
      );
      downloadBlob(blob, fileName.fullName);
      setMessage("Download started.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAction(null);
    }
  }, [action, capturedFramegrab, fileName.fullName, format, quality]);

  return {
    dialogMounted,
    capturedFramegrab,
    dialogOpen,
    format,
    quality,
    action,
    error,
    message,
    fileName,
    disabledReason,
    openDialog,
    closeDialog,
    handleFormatChange,
    handleQualityChange,
    copyFramegrab,
    downloadFramegrab,
  };
}
