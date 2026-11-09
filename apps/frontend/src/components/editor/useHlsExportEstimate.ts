import { logEventFields, warnWithError } from "@cliparr/shared/logging";
import type { Logger } from "@logtape/logtape";
import { useEffect, useRef, useState } from "react";

import {
  fetchHlsExportEstimateVariants,
  selectHlsExportEstimateMetadata,
} from "@/lib/export/hlsExportEstimate";
import type { PixelDimensions } from "#/lib/mediaDimensions";

const HLS_ESTIMATE_REFRESH_MS = 60_000;

export function useHlsExportEstimate({
  url,
  role,
  sessionId,
  outputDimensions,
  logger,
}: {
  url: string | null;
  role: string | undefined;
  sessionId: string;
  outputDimensions: PixelDimensions | null;
  logger: Logger;
}) {
  const [source, setSource] = useState<{
    sessionId: string;
    url: string;
    fetchedAt: number;
    variants: NonNullable<
      Awaited<ReturnType<typeof fetchHlsExportEstimateVariants>>
    >;
  } | null>(null);
  const retainedSource = useRef(source);

  useEffect(() => {
    if (!url) {
      return;
    }

    const controller = new AbortController();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      setSource(null);
      try {
        const variants = await fetchHlsExportEstimateVariants(
          url,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          const nextSource = variants
            ? { sessionId, url, variants, fetchedAt: Date.now() }
            : null;
          retainedSource.current = nextSource;
          setSource(nextSource);
        }
      } catch (error: unknown) {
        const isAbortError =
          error instanceof Error && error.name === "AbortError";
        if (!controller.signal.aborted && !isAbortError) {
          retainedSource.current = null;
          setSource(null);
          warnWithError(
            logger,
            error,
            "Could not fetch HLS export estimate metadata.",
            {
              ...logEventFields("editor.export.hls_estimate", "failure"),
              "export.source.kind": "hls",
              "export.source.role": role,
            },
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          refreshTimer = setTimeout(() => {
            void refresh();
          }, HLS_ESTIMATE_REFRESH_MS);
        }
      }
    };
    const retained = retainedSource.current;
    const age = retained ? Date.now() - retained.fetchedAt : Infinity;
    if (
      retained?.sessionId === sessionId &&
      retained.url === url &&
      age < HLS_ESTIMATE_REFRESH_MS
    ) {
      setSource(retained);
      refreshTimer = setTimeout(() => {
        void refresh();
      }, HLS_ESTIMATE_REFRESH_MS - age);
    } else {
      void refresh();
    }
    return () => {
      controller.abort();
      clearTimeout(refreshTimer);
    };
  }, [logger, role, sessionId, url]);

  return url && source?.sessionId === sessionId && source.url === url
    ? selectHlsExportEstimateMetadata(source.variants, outputDimensions)
    : null;
}
