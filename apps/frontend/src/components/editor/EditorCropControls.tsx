import { useEffect, useRef, useState } from "react";

import {
  constrainCropRectangle,
  cropRectangle,
  cropRegion,
  cropWithAspectRatio,
} from "#/components/editor/editorCropGeometry";
import {
  type EditorCropState,
  EMPTY_EDITOR_CROP,
} from "#/components/editor/editorCropState";
import {
  EditorPropertyRow,
  EditorPropertySection,
} from "#/components/editor/EditorPropertyControls";
import {
  editorActionButtonClasses,
  editorPropertyControlClasses,
} from "#/components/ui/control-styles";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import type { PixelDimensions } from "#/lib/mediaDimensions";

const ratios = [
  ["16:9", 16 / 9],
  ["9:16", 9 / 16],
  ["1:1", 1],
  ["4:3", 4 / 3],
  ["4:5", 4 / 5],
] as const;

function CropNumber({
  label,
  prefix,
  value,
  min = 0,
  max,
  step = 1,
  onCommit,
}: {
  label: string;
  prefix?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const edited = useRef(false);
  useEffect(() => {
    setText(String(value));
    edited.current = false;
  }, [value]);
  return (
    <label
      className={`${editorPropertyControlClasses} flex min-w-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-editor-border bg-editor-control px-2 text-muted-foreground focus-within:border-ring`}
    >
      <span aria-hidden="true" className="shrink-0">
        {prefix}
      </span>
      <input
        data-editor-crop-number
        aria-label={label}
        className="editor-control-focus h-full min-w-0 flex-1 bg-transparent text-editor-input text-right text-foreground outline-none lg:text-xs"
        type="number"
        inputMode={step === 1 ? "numeric" : "decimal"}
        min={min}
        max={max}
        step={step}
        value={text}
        onInput={() => {
          edited.current = true;
        }}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const number = Number(text);
          const shouldCommit = edited.current;
          edited.current = false;
          if (
            shouldCommit &&
            text.trim() &&
            Number.isFinite(number) &&
            number >= min
          ) {
            const next = Math.min(number, max ?? Infinity);
            // Explicit edits can match the rounded display while changing the
            // precise crop. Untouched focus/blur must preserve that precision.
            onCommit(next);
          }
          setText(String(value));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

export function EditorCropControls({
  state,
  dimensions,
  error,
  onChange,
  onDone,
}: {
  state: EditorCropState;
  dimensions: PixelDimensions;
  error?: string | null;
  onChange: (state: EditorCropState) => void;
  onDone: () => void;
}) {
  const [custom, setCustom] = useState(false);
  const rectangle = cropRectangle(state.region, dimensions);
  const sourceRatio = dimensions.width / dimensions.height;
  let ratioValue = "custom";
  if (state.aspectRatio === null) {
    ratioValue = "free";
  } else if (!custom) {
    ratioValue =
      state.aspectRatio === sourceRatio
        ? "source"
        : (ratios.find(([, value]) => value === state.aspectRatio)?.[0] ??
          "custom");
  }
  const applyRatio = (aspectRatio: number | null) =>
    onChange({
      aspectRatio,
      region: aspectRatio
        ? cropWithAspectRatio(state.region, dimensions, aspectRatio)
        : state.region,
    });
  const changeField = (field: keyof typeof rectangle, value: number) => {
    let next = { ...rectangle, [field]: value };
    if (state.aspectRatio && (field === "width" || field === "height")) {
      next =
        field === "width"
          ? { ...next, height: value / state.aspectRatio }
          : { ...next, width: value * state.aspectRatio };
    }
    next = constrainCropRectangle(
      next,
      dimensions,
      field === "width" || field === "height" ? { x: next.x, y: next.y } : null,
      state.aspectRatio,
    );
    onChange({ ...state, region: cropRegion(next, dimensions) });
  };
  const selectRatio = (value: string | null) => {
    if (!value) {
      return;
    }
    setCustom(value === "custom");
    switch (value) {
      case "free": {
        applyRatio(null);
        break;
      }
      case "source": {
        applyRatio(sourceRatio);
        break;
      }
      case "custom": {
        applyRatio(rectangle.width / rectangle.height);
        break;
      }
      default: {
        const ratio = ratios.find(([label]) => label === value);
        if (ratio) {
          applyRatio(ratio[1]);
        }
      }
    }
  };
  const numberField = (
    field: keyof typeof rectangle,
    label: string,
    prefix: string,
  ) => (
    <CropNumber
      label={label}
      prefix={prefix}
      value={Math.round(rectangle[field])}
      min={field === "width" || field === "height" ? 1 : 0}
      max={
        field === "x" || field === "width"
          ? dimensions.width
          : dimensions.height
      }
      onCommit={(value) => changeField(field, value)}
    />
  );
  return (
    <section
      aria-label="Crop controls"
      className="bg-editor-panel text-sidebar-foreground"
    >
      <div className="border-b border-editor-border p-3">
        <div className="flex gap-2">
          <button
            type="button"
            className={editorActionButtonClasses}
            disabled={Boolean(error)}
            onClick={() =>
              onChange({
                ...state,
                region: cropRegion(
                  {
                    ...rectangle,
                    x: (dimensions.width - rectangle.width) / 2,
                    y: (dimensions.height - rectangle.height) / 2,
                  },
                  dimensions,
                ),
              })
            }
          >
            Center
          </button>
          <button
            type="button"
            className={editorActionButtonClasses}
            onClick={() => {
              setCustom(false);
              onChange(EMPTY_EDITOR_CROP);
            }}
          >
            Remove crop
          </button>
          <button
            type="button"
            className={`${editorActionButtonClasses} ml-auto`}
            onClick={onDone}
          >
            Done
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <fieldset disabled={Boolean(error)} className="disabled:opacity-50">
        <EditorPropertySection title="Selection">
          <EditorPropertyRow label="Aspect ratio">
            <Select
              value={ratioValue}
              items={{
                free: "Free",
                source: "Source",
                ...Object.fromEntries(ratios.map(([label]) => [label, label])),
                custom: "Custom",
              }}
              onValueChange={selectRatio}
            >
              <SelectTrigger
                size="sm"
                variant="editor"
                aria-label="Aspect ratio"
                className={editorPropertyControlClasses}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="source">Source</SelectItem>
                {ratios.map(([label]) => (
                  <SelectItem key={label} value={label}>
                    {label}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </EditorPropertyRow>
          {ratioValue === "custom" && (
            <EditorPropertyRow label="Ratio">
              <CropNumber
                label="Custom width / height"
                value={Number((state.aspectRatio ?? 1).toFixed(4))}
                min={0.01}
                step={0.01}
                onCommit={applyRatio}
              />
            </EditorPropertyRow>
          )}
        </EditorPropertySection>
        <EditorPropertySection title="Region">
          <EditorPropertyRow label="Position">
            <span className="grid grid-cols-2 gap-2">
              {numberField("x", "X position", "X")}
              {numberField("y", "Y position", "Y")}
            </span>
          </EditorPropertyRow>
          <EditorPropertyRow label="Size">
            <span className="grid grid-cols-2 gap-2">
              {numberField("width", "Width", "W")}
              {numberField("height", "Height", "H")}
            </span>
          </EditorPropertyRow>
        </EditorPropertySection>
      </fieldset>
    </section>
  );
}
