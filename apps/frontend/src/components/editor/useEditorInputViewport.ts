import { useEffect, useState } from "react";

/** Keep editor inputs in the visible viewport without disabling page zoom. */
export function useEditorInputViewport(onResize: () => void) {
  const [root, connectRoot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!root || !viewport) {
      return;
    }
    let frame = 0;
    let adjusted = false;
    let offset = 0;
    const reset = () => {
      adjusted = false;
      offset = 0;
      root.style.removeProperty("--editor-visible-height");
      root.style.removeProperty("--editor-visible-offset");
      delete root.dataset.inputViewport;
    };
    const update = () => {
      const active = document.activeElement;
      const editing =
        (active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement) &&
        root.contains(active);
      if (viewport.scale !== 1 || (!editing && !adjusted)) {
        reset();
        return;
      }
      const layoutBottom =
        document.documentElement.clientHeight + window.scrollY;
      const safeBottom =
        Number.parseFloat(
          getComputedStyle(root.parentElement ?? root).paddingBottom,
        ) || 0;
      const top = root.getBoundingClientRect().top + window.scrollY - offset;
      const bottom = Math.min(
        layoutBottom - safeBottom,
        viewport.pageTop + viewport.height,
      );
      const clipped = bottom < layoutBottom - safeBottom - 1;
      if (!clipped) {
        reset();
        return;
      }
      const nextOffset = Math.max(0, viewport.pageTop - top);
      const height = Math.max(0, bottom - top - nextOffset);
      if (
        !adjusted ||
        nextOffset !== offset ||
        root.style.getPropertyValue("--editor-visible-height") !== `${height}px`
      ) {
        onResize();
        root.style.setProperty("--editor-visible-height", `${height}px`);
        root.style.setProperty("--editor-visible-offset", `${nextOffset}px`);
      }
      offset = nextOffset;
      adjusted = true;
      root.dataset.inputViewport = "true";
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    root.addEventListener("focusin", schedule);
    root.addEventListener("focusout", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      root.removeEventListener("focusin", schedule);
      root.removeEventListener("focusout", schedule);
      reset();
    };
  }, [root, onResize]);
  return connectRoot;
}
