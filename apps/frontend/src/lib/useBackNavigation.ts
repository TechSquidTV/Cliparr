import { useCanGoBack } from "@tanstack/react-router";
import { useCallback } from "react";

import { router } from "#/router";

export function useBackNavigation(fallback: "/" | "/dashboard") {
  const canGoBack = useCanGoBack();

  return useCallback(() => {
    if (canGoBack) {
      globalThis.history.back();
      return;
    }

    void router.navigate({ to: fallback, replace: true });
  }, [canGoBack, fallback]);
}
