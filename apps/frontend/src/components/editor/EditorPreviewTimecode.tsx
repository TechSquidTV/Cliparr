import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from "react";

interface EditorPreviewTimecodeProps {
  ariaHidden?: boolean;
  currentTime: number;
  duration: number;
}

interface TimecodeShellProps {
  hoursWidth: string;
  minutesWidth: string;
  showHours: boolean;
  slotRefs: TimecodeSlotRefs;
}

interface PreviewTimecodeParts {
  fraction: string;
  hours: string;
  label: string;
  minutes: string;
  seconds: string;
}

type TimecodeSlotRefs = Record<
  "fraction" | "hours" | "minutes" | "seconds",
  RefObject<HTMLSpanElement | null>
>;

const CENTISECONDS_PER_SECOND = 100;
const CENTISECONDS_PER_MINUTE = 60 * CENTISECONDS_PER_SECOND;
const CENTISECONDS_PER_HOUR = 60 * CENTISECONDS_PER_MINUTE;
const FIXED_DIGIT_WIDTH = "2ch";

function getPreviewCentiseconds(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return 0;
  }

  return Math.max(0, Math.round(seconds * CENTISECONDS_PER_SECOND));
}

function getPreviewTimecodeParts(centiseconds: number, showHours: boolean): PreviewTimecodeParts {
  const hours = Math.floor(centiseconds / CENTISECONDS_PER_HOUR);
  const remainingAfterHours = centiseconds % CENTISECONDS_PER_HOUR;
  const minutes = Math.floor(remainingAfterHours / CENTISECONDS_PER_MINUTE);
  const totalMinutes = Math.floor(centiseconds / CENTISECONDS_PER_MINUTE);
  const seconds = Math.floor((centiseconds % CENTISECONDS_PER_MINUTE) / CENTISECONDS_PER_SECOND);
  const fraction = centiseconds % CENTISECONDS_PER_SECOND;

  const hoursText = hours.toString();
  const minutesText = showHours ? minutes.toString().padStart(2, "0") : totalMinutes.toString();
  const secondsText = seconds.toString().padStart(2, "0");
  const fractionText = fraction.toString().padStart(2, "0");
  const label = showHours
    ? `${hoursText}:${minutesText}:${secondsText}.${fractionText}`
    : `${minutesText}:${secondsText}.${fractionText}`;

  return {
    fraction: fractionText,
    hours: hoursText,
    label,
    minutes: minutesText,
    seconds: secondsText,
  };
}

function setSlotText(ref: RefObject<HTMLSpanElement | null>, value: string) {
  const slot = ref.current;

  if (slot && slot.textContent !== value) {
    slot.textContent = value;
  }
}

function updateTimecodeSlots(slotRefs: TimecodeSlotRefs, parts: PreviewTimecodeParts) {
  setSlotText(slotRefs.hours, parts.hours);
  setSlotText(slotRefs.minutes, parts.minutes);
  setSlotText(slotRefs.seconds, parts.seconds);
  setSlotText(slotRefs.fraction, parts.fraction);
}

function useTimecodeSlotRefs(): TimecodeSlotRefs {
  const hours = useRef<HTMLSpanElement>(null);
  const minutes = useRef<HTMLSpanElement>(null);
  const seconds = useRef<HTMLSpanElement>(null);
  const fraction = useRef<HTMLSpanElement>(null);

  return useMemo(() => ({
    fraction,
    hours,
    minutes,
    seconds,
  }), []);
}

function getHoursWidth(durationParts: PreviewTimecodeParts) {
  return `${Math.max(1, durationParts.hours.length)}ch`;
}

function getMinutesWidth(durationParts: PreviewTimecodeParts, showHours: boolean) {
  return `${Math.max(showHours ? 2 : 1, durationParts.minutes.length)}ch`;
}

function arePreviewTimecodePropsEqual(
  previous: EditorPreviewTimecodeProps,
  next: EditorPreviewTimecodeProps,
) {
  return (
    previous.ariaHidden === next.ariaHidden
    && getPreviewCentiseconds(previous.currentTime) === getPreviewCentiseconds(next.currentTime)
    && getPreviewCentiseconds(previous.duration) === getPreviewCentiseconds(next.duration)
  );
}

const TimecodeShell = memo(function TimecodeShell({
  hoursWidth,
  minutesWidth,
  showHours,
  slotRefs,
}: TimecodeShellProps) {
  return (
    <span className="inline-flex items-baseline">
      {showHours && (
        <>
          <span ref={slotRefs.hours} className="inline-block text-right" style={{ width: hoursWidth }} />
          <span>:</span>
        </>
      )}
      <span ref={slotRefs.minutes} className="inline-block text-right" style={{ width: minutesWidth }} />
      <span>:</span>
      <span ref={slotRefs.seconds} className="inline-block text-right" style={{ width: FIXED_DIGIT_WIDTH }} />
      <span>.</span>
      <span ref={slotRefs.fraction} className="inline-block text-left" style={{ width: FIXED_DIGIT_WIDTH }} />
    </span>
  );
});

export const EditorPreviewTimecode = memo(function EditorPreviewTimecode({
  ariaHidden = false,
  currentTime,
  duration,
}: EditorPreviewTimecodeProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const currentSlotRefs = useTimecodeSlotRefs();
  const durationSlotRefs = useTimecodeSlotRefs();
  const currentCentiseconds = getPreviewCentiseconds(currentTime);
  const durationCentiseconds = getPreviewCentiseconds(duration);
  const showHours = durationCentiseconds >= CENTISECONDS_PER_HOUR;
  const durationParts = useMemo(
    () => getPreviewTimecodeParts(durationCentiseconds, showHours),
    [durationCentiseconds, showHours],
  );
  const hoursWidth = useMemo(() => getHoursWidth(durationParts), [durationParts]);
  const minutesWidth = useMemo(
    () => getMinutesWidth(durationParts, showHours),
    [durationParts, showHours],
  );

  useLayoutEffect(() => {
    const currentParts = getPreviewTimecodeParts(currentCentiseconds, showHours);

    updateTimecodeSlots(currentSlotRefs, currentParts);
    updateTimecodeSlots(durationSlotRefs, durationParts);
    if (ariaHidden) {
      containerRef.current?.removeAttribute("aria-label");
    } else {
      containerRef.current?.setAttribute(
        "aria-label",
        `${currentParts.label} of ${durationParts.label}`,
      );
    }
  }, [
    ariaHidden,
    currentCentiseconds,
    currentSlotRefs,
    durationParts,
    durationSlotRefs,
    showHours,
  ]);

  return (
    <span
      ref={containerRef}
      aria-hidden={ariaHidden || undefined}
      className="flex shrink-0 items-center whitespace-nowrap font-mono text-sm font-semibold tabular-nums text-foreground"
      style={{ contain: "layout style paint" }}
    >
      <span aria-hidden="true" className="inline-flex items-baseline">
        <TimecodeShell
          hoursWidth={hoursWidth}
          minutesWidth={minutesWidth}
          showHours={showHours}
          slotRefs={currentSlotRefs}
        />
        <span className="px-1.5 text-muted-foreground">/</span>
        <TimecodeShell
          hoursWidth={hoursWidth}
          minutesWidth={minutesWidth}
          showHours={showHours}
          slotRefs={durationSlotRefs}
        />
      </span>
    </span>
  );
}, arePreviewTimecodePropsEqual);
