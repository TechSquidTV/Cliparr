import { memo, useMemo } from "react";

interface EditorPreviewTimecodeProps {
  currentTime: number;
  duration: number;
}

interface SegmentedTimecodeProps {
  parts: PreviewTimecodeParts;
  hoursWidth: string;
  minutesWidth: string;
  showHours: boolean;
}

interface TimecodeSlotProps {
  className?: string;
  value: string;
  width: string;
}

interface PreviewTimecodeParts {
  fraction: string;
  hours: string;
  label: string;
  minutes: string;
  seconds: string;
}

const CENTISECONDS_PER_SECOND = 100;
const CENTISECONDS_PER_MINUTE = 60 * CENTISECONDS_PER_SECOND;
const CENTISECONDS_PER_HOUR = 60 * CENTISECONDS_PER_MINUTE;

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

const TimecodeSlot = memo(function TimecodeSlot({
  className = "",
  value,
  width,
}: TimecodeSlotProps) {
  return (
    <span className={`inline-block ${className}`} style={{ width }}>
      {value}
    </span>
  );
});

const SegmentedTimecode = memo(function SegmentedTimecode({
  parts,
  hoursWidth,
  minutesWidth,
  showHours,
}: SegmentedTimecodeProps) {
  return (
    <span className="inline-flex items-baseline">
      {showHours && (
        <>
          <TimecodeSlot className="text-right" value={parts.hours} width={hoursWidth} />
          <span>:</span>
        </>
      )}
      <TimecodeSlot className="text-right" value={parts.minutes} width={minutesWidth} />
      <span>:</span>
      <TimecodeSlot className="text-right" value={parts.seconds} width="2ch" />
      <span>.</span>
      <TimecodeSlot className="text-left" value={parts.fraction} width="2ch" />
    </span>
  );
});

export const EditorPreviewTimecode = memo(function EditorPreviewTimecode({
  currentTime,
  duration,
}: EditorPreviewTimecodeProps) {
  const currentCentiseconds = getPreviewCentiseconds(currentTime);
  const durationCentiseconds = getPreviewCentiseconds(duration);
  const showHours = durationCentiseconds >= CENTISECONDS_PER_HOUR;
  const currentParts = useMemo(
    () => getPreviewTimecodeParts(currentCentiseconds, showHours),
    [currentCentiseconds, showHours],
  );
  const durationParts = useMemo(
    () => getPreviewTimecodeParts(durationCentiseconds, showHours),
    [durationCentiseconds, showHours],
  );
  const hoursWidth = useMemo(() => {
    return `${Math.max(1, durationParts.hours.length)}ch`;
  }, [durationParts.hours.length]);
  const minutesWidth = useMemo(() => {
    return `${Math.max(showHours ? 2 : 1, durationParts.minutes.length)}ch`;
  }, [durationParts.minutes.length, showHours]);

  return (
    <div
      className="flex shrink-0 items-center whitespace-nowrap font-mono text-sm font-semibold tabular-nums text-foreground"
      aria-label={`${currentParts.label} of ${durationParts.label}`}
    >
      <span aria-hidden="true" className="inline-flex items-baseline">
        <SegmentedTimecode
          hoursWidth={hoursWidth}
          minutesWidth={minutesWidth}
          parts={currentParts}
          showHours={showHours}
        />
        <span className="px-1.5 text-muted-foreground">/</span>
        <SegmentedTimecode
          hoursWidth={hoursWidth}
          minutesWidth={minutesWidth}
          parts={durationParts}
          showHours={showHours}
        />
      </span>
    </div>
  );
});
