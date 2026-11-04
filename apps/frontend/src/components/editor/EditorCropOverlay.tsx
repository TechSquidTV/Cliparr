import CropperCanvas from "@cropper/element-canvas";
import CropperGrid from "@cropper/element-grid";
import CropperHandle from "@cropper/element-handle";
import CropperSelection, { type Selection } from "@cropper/element-selection";
import CropperShade from "@cropper/element-shade";
import { type Ref, useImperativeHandle, useLayoutEffect, useRef } from "react";

import {
  constrainCropRectangle,
  type CropAnchor,
  cropRectangle,
  cropRegion,
  type CropResizeAxis,
} from "#/components/editor/editorCropGeometry";
import type { EditorCropState } from "#/components/editor/editorCropState";
import type { MediaDimensions } from "#/components/editor/editorMedia";

for (const element of [
  CropperCanvas,
  CropperGrid,
  CropperHandle,
  CropperSelection,
  CropperShade,
]) {
  element.$define();
}

const HANDLE_TARGET_SIZE = 44;

const CROP_HANDLE_STYLES = `
  :host([action$=-resize])::after {
    width: 12px;
    height: 12px;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    background: var(--editor-crop-accent);
    box-shadow: var(--editor-crop-handle-shadow);
    border-radius: 50%;
    transition: transform var(--motion-duration-fast) var(--motion-easing-standard);
  }
  :host([action=n-resize])::after,
  :host([action=s-resize])::after {
    width: 24px;
    height: 6px;
    border-radius: 2px;
  }
  :host([action=e-resize])::after,
  :host([action=w-resize])::after {
    width: 6px;
    height: 24px;
    border-radius: 2px;
  }
  @media (hover: hover) and (pointer: fine) {
    :host([action$=-resize]:hover)::after {
      transform: translate(-50%, -50%) scale(1.15);
    }
  }
  :host([action$=-resize]:active)::after {
    transform: translate(-50%, -50%) scale(0.9);
  }
  @media (prefers-reduced-motion: reduce) {
    :host([action$=-resize])::after { transition: none; }
  }
`;

function createCropHandles(selection: CropperSelection) {
  const handles: CropperHandle[] = [];
  const sideHandles = new Map<CropperHandle, CropResizeAxis>();
  for (const direction of ["n", "e", "s", "w", "nw", "ne", "sw", "se"]) {
    const handle = new CropperHandle();
    handle.action = `${direction}-resize`;
    handle.setAttribute("aria-hidden", "true");
    handle.style.cssText = `width:${HANDLE_TARGET_SIZE}px;height:${HANDLE_TARGET_SIZE}px;background:transparent;border:none;transform:none`;
    const offset = `${-HANDLE_TARGET_SIZE / 2}px`;
    const midpoint = `calc(50% - ${HANDLE_TARGET_SIZE / 2}px)`;
    handle.style.top = direction.includes("s") ? "auto" : midpoint;
    handle.style.bottom = direction.includes("s") ? offset : "auto";
    handle.style.left = direction.includes("e") ? "auto" : midpoint;
    handle.style.right = direction.includes("e") ? offset : "auto";
    if (direction.includes("n")) {
      handle.style.top = offset;
    }
    if (direction.includes("w")) {
      handle.style.left = offset;
    }
    if (direction.length === 1) {
      sideHandles.set(
        handle,
        direction === "n" || direction === "s" ? "vertical" : "horizontal",
      );
    }
    handles.push(handle);
    selection.append(handle);
  }
  return { handles, sideHandles };
}

export interface EditorCropOverlayHandle {
  finishGesture: () => void;
}

interface Properties {
  ref?: Ref<EditorCropOverlayHandle>;
  state: EditorCropState;
  dimensions: MediaDimensions;
  onChange: (state: EditorCropState) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}
interface CropperAction {
  action: string;
  relatedEvent: PointerEvent;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export function EditorCropOverlay(properties: Properties) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(properties);
  latest.current = properties;
  const synchronize = useRef<(() => void) | null>(null);

  const endGesture = useRef<(() => void) | null>(null);
  useImperativeHandle(
    properties.ref,
    () => ({
      finishGesture: () => endGesture.current?.(),
    }),
    [],
  );

  useLayoutEffect(() => {
    const container = host.current;
    if (!container) {
      return;
    }
    const canvas = new CropperCanvas();
    canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;min-width:0;min-height:0;overflow:visible";
    const shade = new CropperShade();
    shade.themeColor = "rgba(0, 0, 0, 0.6)";
    // Document-level outline resets override a custom element's host styles.
    shade.style.outlineColor = shade.themeColor;
    const selection = new CropperSelection();
    selection.movable = true;
    selection.resizable = true;
    selection.precise = true;
    selection.outlined = true;
    selection.themeColor = "var(--editor-crop-accent)";
    selection.style.outline = "1px solid var(--editor-crop-accent)";
    // Use the cancelable change event for clamping. minInset rejects an entire
    // beyond-boundary movement instead of letting the selection reach the edge.
    const draw = new CropperHandle();
    draw.action = "select";
    draw.plain = true;
    const move = new CropperHandle();
    move.action = "move";
    move.plain = true;
    const grid = new CropperGrid();
    grid.covered = true;
    grid.themeColor =
      "color-mix(in srgb, var(--editor-crop-accent) 30%, transparent)";
    grid.setAttribute("aria-hidden", "true");
    selection.append(grid, move);
    const { handles, sideHandles } = createCropHandles(selection);
    canvas.append(shade, draw, selection);
    container.append(canvas);
    // Custom-element shadow roots exist after connecting the canvas.
    for (const handle of handles) {
      handle.$addStyles(CROP_HANDLE_STYLES);
    }
    let synchronizing = false;
    let correcting = false;
    let active = false;
    let activePointerId: number | null = null;
    let action = "";
    let resizeAxis: CropResizeAxis | null = null;
    let activeHandle: CropperHandle | null = null;
    let shiftResizing = false;
    let anchor: CropAnchor | null = null;
    const bounds = () => canvas.getBoundingClientRect();
    const updateSideHandles = (rectangle: Selection) => {
      for (const [handle, axis] of sideHandles) {
        // Leave 44px between centers of neighboring targets. Keep a held
        // handle available until release even when resizing below that limit.
        const fits =
          axis === "vertical"
            ? rectangle.width >= HANDLE_TARGET_SIZE * 2 &&
              rectangle.height >= HANDLE_TARGET_SIZE
            : rectangle.height >= HANDLE_TARGET_SIZE * 2 &&
              rectangle.width >= HANDLE_TARGET_SIZE;
        handle.hidden = !fits && handle !== activeHandle;
      }
    };
    const sync = () => {
      const size = bounds();
      if (!size.width || !size.height || active) {
        return;
      }
      const { state } = latest.current;
      move.action = state.region ? "move" : "select";
      const rectangle = cropRectangle(state.region, size);
      updateSideHandles(rectangle);
      synchronizing = true;
      selection.aspectRatio = state.aspectRatio ?? NaN;
      selection.$change(
        rectangle.x,
        rectangle.y,
        rectangle.width,
        rectangle.height,
        NaN,
      );
      synchronizing = false;
    };
    synchronize.current = sync;
    const finish = () => {
      if (active) {
        active = false;
        activePointerId = null;
        activeHandle = null;
        shiftResizing = false;
        canvas.$setAction("none");
        latest.current.onGestureEnd();
        sync();
      }
    };
    endGesture.current = finish;
    const start = (event: Event) => {
      const { action: next, relatedEvent } = (
        event as CustomEvent<CropperAction>
      ).detail;
      const handle = handles.find((candidate) => candidate.action === next);
      if (active || !(next === "select" || next === "move" || handle)) {
        event.preventDefault();
        return;
      }
      active = true;
      activePointerId = relatedEvent.pointerId;
      action = next;
      activeHandle = handle ?? null;
      resizeAxis = handle ? (sideHandles.get(handle) ?? null) : null;
      container.focus({ preventScroll: true });
      const box = canvas.getBoundingClientRect();
      const fixedX = next.includes("w")
        ? selection.x + selection.width
        : selection.x;
      const fixedY = next.includes("n")
        ? selection.y + selection.height
        : selection.y;
      anchor =
        next === "select"
          ? {
              x: relatedEvent.clientX - box.left,
              y: relatedEvent.clientY - box.top,
            }
          : {
              x:
                resizeAxis === "vertical"
                  ? selection.x + selection.width / 2
                  : fixedX,
              y:
                resizeAxis === "horizontal"
                  ? selection.y + selection.height / 2
                  : fixedY,
            };
      latest.current.onGestureStart();
    };
    const end = (event: Event) => {
      const { relatedEvent } = (event as CustomEvent<CropperAction>).detail;
      if (relatedEvent.pointerId !== activePointerId) {
        // Releasing a rejected second finger must not end the first drag.
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      finish();
    };
    const act = (event: Event) => {
      const detail = (event as CustomEvent<CropperAction>).detail;
      action = detail.action;
      shiftResizing = Boolean(activeHandle && detail.relatedEvent.shiftKey);
      if (action === "select" && anchor) {
        // Initialize at the actual pointer-down corner. This avoids Cropper's
        // first-movement offset when starting an upward or leftward selection.
        event.preventDefault();
        const box = canvas.getBoundingClientRect();
        selection.$change(anchor.x, anchor.y, 0, 0, NaN);
        selection.$resize(
          "se-resize",
          detail.endX - (box.left + window.scrollX) - anchor.x,
          detail.endY - (box.top + window.scrollY) - anchor.y,
        );
      }
    };
    const change = (event: Event) => {
      if (synchronizing || correcting) {
        return;
      }
      const proposed = (event as CustomEvent<Selection>).detail;
      if (!proposed.width || !proposed.height) {
        return;
      }
      const bounded = constrainCropRectangle(
        proposed,
        bounds(),
        active && action !== "move" ? anchor : null,
        // Cropper has already applied the temporary Shift ratio to its proposal.
        // Preserve that ratio while clamping without changing the saved setting.
        latest.current.state.aspectRatio ??
          (shiftResizing ? proposed.width / proposed.height : null),
        active ? resizeAxis : null,
      );
      if (!bounded.width || !bounded.height) {
        event.preventDefault();
        return;
      }
      if (
        Object.keys(bounded).some(
          (key) =>
            bounded[key as keyof Selection] !==
            proposed[key as keyof Selection],
        )
      ) {
        event.preventDefault();
        correcting = true;
        selection.$change(
          bounded.x,
          bounded.y,
          bounded.width,
          bounded.height,
          NaN,
        );
        correcting = false;
      }
      updateSideHandles(bounded);
      // Layout resizes and property synchronization must never create edits.
      if (active) {
        const normalized = cropRegion(bounded, bounds());
        latest.current.onChange({
          ...latest.current.state,
          region: normalized
            ? {
                ...normalized,
                sourceAspectRatio:
                  latest.current.dimensions.width /
                  latest.current.dimensions.height,
              }
            : null,
        });
      }
    };
    canvas.addEventListener("actionstart", start, { capture: true });
    canvas.addEventListener("action", act, { capture: true });
    canvas.addEventListener("actionend", end, { capture: true });
    selection.addEventListener("change", change);
    window.addEventListener("blur", finish);
    const observer = new ResizeObserver(() => {
      finish();
      sync();
    });
    observer.observe(canvas);
    sync();
    return () => {
      finish();
      observer.disconnect();
      window.removeEventListener("blur", finish);
      synchronize.current = null;
      endGesture.current = null;
      canvas.remove();
    };
  }, []);
  useLayoutEffect(
    () => synchronize.current?.(),
    [properties.state, properties.dimensions],
  );

  return (
    <div
      ref={host}
      role="group"
      aria-label="Crop selection. Use arrow keys to move; hold Shift for larger steps."
      tabIndex={0}
      className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-primary"
      onKeyDown={(event) => {
        const movements: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        const movement = movements[event.key];
        if (!movement || event.altKey || event.ctrlKey || event.metaKey) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        endGesture.current?.();
        const rectangle = cropRectangle(
          properties.state.region,
          properties.dimensions,
        );
        const step = event.shiftKey ? 10 : 1;
        properties.onChange({
          ...properties.state,
          region: cropRegion(
            {
              ...rectangle,
              x: rectangle.x + movement[0] * step,
              y: rectangle.y + movement[1] * step,
            },
            properties.dimensions,
          ),
        });
      }}
    />
  );
}
