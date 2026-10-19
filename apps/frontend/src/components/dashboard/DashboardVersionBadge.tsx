import { type CliparrVersionInfo } from "#/api/cliparrClient";
import { ControlTooltip } from "#/components/ui/tooltip";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#/components/ui/tooltip";
import { cn } from "#/lib/cn";

const DASHBOARD_VERSION_BADGE_CLASS =
  "hidden min-h-5 min-w-15 items-center justify-center rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground sm:inline-flex";
export function DashboardVersionBadge({
  latestRelease,
  releaseChecksDisabledReason,
  versionLabel,
}: {
  latestRelease: CliparrVersionInfo["latestRelease"] | null;
  releaseChecksDisabledReason?: string | null;
  versionLabel: string;
}) {
  if (!versionLabel) {
    return (
      <span
        className={cn(DASHBOARD_VERSION_BADGE_CLASS, "invisible")}
        aria-hidden="true"
        data-dashboard-version-badge
      >
        0.0.0
      </span>
    );
  }

  if (!latestRelease) {
    return (
      <ControlTooltip label={releaseChecksDisabledReason ?? undefined}>
        <span
          className={DASHBOARD_VERSION_BADGE_CLASS}
          tabIndex={releaseChecksDisabledReason ? 0 : undefined}
          data-dashboard-version-badge
          data-dashboard-release-check-disabled={
            releaseChecksDisabledReason ? true : undefined
          }
        >
          {versionLabel}
        </span>
      </ControlTooltip>
    );
  }

  const updateLabel = `${latestRelease.tagName} is available`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={latestRelease.url}
            target="_blank"
            rel="noreferrer"
            className={cn(
              DASHBOARD_VERSION_BADGE_CLASS,
              "control-focus gap-1.5 border-primary/40 bg-primary/10 text-primary transition-colors hover:bg-primary/15",
            )}
            aria-label={`${updateLabel}. View release notes.`}
            data-dashboard-version-badge
            data-dashboard-update-available
          >
            <span>{versionLabel}</span>
            <span
              className="h-1.5 w-1.5 rounded-full bg-primary"
              aria-hidden="true"
              data-dashboard-update-indicator
            />
            <span
              className="text-[11px] leading-none font-medium text-primary/80"
              data-dashboard-update-label
            >
              Update available
            </span>
          </a>
        }
      />
      <TooltipContent side="top" align="start">
        {updateLabel}
      </TooltipContent>
    </Tooltip>
  );
}
