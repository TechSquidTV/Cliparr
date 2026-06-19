import { Popover } from "@base-ui/react/popover";
import { Check, ChevronDown, Search, Users, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import {
  sanitizeDashboardViewerFilterNames,
  type DashboardViewerFilterOption,
} from "@/components/dashboardPlaybackItems";
import { DashboardViewerAvatar } from "@/components/DashboardViewerAvatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cliparrMotionTransitions } from "@/lib/motionPresets";
import { cn } from "@/lib/utilities";

const DASHBOARD_VIEWER_FILTER_TRIGGER_VISIBLE_AVATAR_COUNT = 2;

function formatFilterSessionCount(count: number) {
  return `${count} ${count === 1 ? "session" : "sessions"}`;
}

function formatFilterHiddenCount(count: number) {
  return `${count} ${count === 1 ? "session is" : "sessions are"} hidden by the viewer filter.`;
}

function dashboardViewerFilterTriggerLabel(
  viewerOptions: DashboardViewerFilterOption[],
  selectedViewerNames: readonly string[],
) {
  const selectedNames = sanitizeDashboardViewerFilterNames(selectedViewerNames);
  if (selectedNames.length === 0) {
    return "All viewers";
  }

  if (selectedNames.length === 1) {
    const [selectedName] = selectedNames;
    const option = viewerOptions.find(
      (viewerOption) => viewerOption.normalizedName === selectedName,
    );
    return option?.name ?? selectedName;
  }

  return `${selectedNames.length} viewers`;
}

function selectedDashboardViewerFilterOptions(
  viewerOptions: DashboardViewerFilterOption[],
  selectedViewerNames: readonly string[],
): DashboardViewerFilterOption[] {
  const optionsByName = new Map(
    viewerOptions.map((option) => [option.normalizedName, option]),
  );

  return sanitizeDashboardViewerFilterNames(selectedViewerNames).map(
    (selectedName) =>
      optionsByName.get(selectedName) ?? {
        normalizedName: selectedName,
        name: selectedName,
        sessionCount: 0,
      },
  );
}

function DashboardViewerFilterTriggerSelection({
  selectedViewerOptions,
}: {
  selectedViewerOptions: DashboardViewerFilterOption[];
}) {
  const visibleViewerOptions = selectedViewerOptions.slice(
    0,
    DASHBOARD_VIEWER_FILTER_TRIGGER_VISIBLE_AVATAR_COUNT,
  );
  const hiddenViewerCount = Math.max(
    selectedViewerOptions.length - visibleViewerOptions.length,
    0,
  );

  return (
    <span
      className="flex min-w-0 flex-1 items-center justify-center gap-1 sm:justify-end"
      data-dashboard-viewer-filter-selected-avatars
      aria-hidden="true"
    >
      <span className="isolate flex shrink-0 -space-x-2">
        {visibleViewerOptions.map((option, index) => (
          <span
            key={option.normalizedName}
            className="relative rounded-full bg-background ring-2 ring-background"
            style={{ zIndex: index + 1 }}
          >
            <DashboardViewerAvatar
              name={option.name}
              avatarUrl={option.avatarUrl}
              size="xs"
            />
          </span>
        ))}
        {hiddenViewerCount > 0 ? (
          <span
            className="relative inline-flex h-6 shrink-0 items-center rounded-full border border-border bg-background px-1.5 text-[11px] leading-none font-semibold text-muted-foreground ring-2 ring-background"
            style={{ zIndex: visibleViewerOptions.length + 1 }}
            data-dashboard-viewer-filter-overflow-count
          >
            (+{hiddenViewerCount})
          </span>
        ) : null}
      </span>
    </span>
  );
}

export function DashboardViewerFilterPicker({
  viewerOptions,
  selectedViewerNames,
  hiddenSessionCount,
  onToggleViewer,
  onClearViewerFilter,
  className,
}: {
  viewerOptions: DashboardViewerFilterOption[];
  selectedViewerNames: readonly string[];
  hiddenSessionCount: number;
  onToggleViewer: (viewerName: string) => void;
  onClearViewerFilter: () => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const selectedNames = sanitizeDashboardViewerFilterNames(selectedViewerNames);
  const selectedNamesSet = new Set(selectedNames);
  const filterActive = selectedNames.length > 0;
  const reduceMotion = useReducedMotion();
  const microHover = reduceMotion ? undefined : { y: -1 };
  const microTap = reduceMotion ? undefined : { scale: 0.985 };
  const microTransition = reduceMotion
    ? { duration: 0 }
    : cliparrMotionTransitions.fast;
  const queryText = query.trim().toLowerCase();
  const filteredViewerOptions = queryText
    ? viewerOptions.filter((option) =>
        option.name.toLowerCase().includes(queryText),
      )
    : viewerOptions;
  const triggerLabel = dashboardViewerFilterTriggerLabel(
    viewerOptions,
    selectedNames,
  );
  const selectedViewerOptions = selectedDashboardViewerFilterOptions(
    viewerOptions,
    selectedNames,
  );
  const totalSessionCount = viewerOptions.reduce(
    (sum, option) => sum + option.sessionCount,
    0,
  );

  if (viewerOptions.length <= 1) {
    return null;
  }

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Filter sessions by viewer: ${triggerLabel}`}
        data-dashboard-viewer-filter
        data-dashboard-viewer-filter-active={filterActive || undefined}
        className={(state) =>
          cn(
            "inline-flex h-11 w-full min-w-0 items-center justify-center gap-1.5 rounded-lg border border-border px-2 text-sm font-semibold text-muted-foreground transition-[color,background-color,border-color,transform] duration-200 hover:-translate-y-px hover:bg-accent hover:text-foreground active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:outline-none motion-reduce:transform-none sm:h-9 sm:w-52 sm:shrink-0 sm:gap-2 sm:px-3 sm:font-medium",
            state.open &&
              "[&_[data-dashboard-viewer-filter-chevron]]:rotate-180",
            filterActive &&
              "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
            className,
          )
        }
      >
        <Users className="h-4 w-4 shrink-0" />
        <span className="hidden shrink-0 sm:inline">Viewers</span>
        {filterActive ? (
          <>
            <DashboardViewerFilterTriggerSelection
              selectedViewerOptions={selectedViewerOptions}
            />
            <span className="sr-only">{triggerLabel}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-left">All viewers</span>
        )}
        <span
          className="shrink-0 transition-transform duration-200 motion-reduce:transition-none"
          data-dashboard-viewer-filter-chevron
          aria-hidden="true"
        >
          <ChevronDown className="h-4 w-4 opacity-70" />
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end">
          <Popover.Popup
            className={cn(
              "z-50 w-[min(calc(100vw-2rem),22rem)] rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg outline-none",
              "data-[ending-style]:animate-out data-[ending-style]:fade-out-0 data-[ending-style]:zoom-out-95 data-[starting-style]:animate-in data-[starting-style]:fade-in-0 data-[starting-style]:zoom-in-95",
            )}
            initialFocus={false}
          >
            <div className="px-2 py-1.5">
              <Popover.Title className="text-sm font-semibold text-foreground">
                Filter by viewer
              </Popover.Title>
              <Popover.Description className="mt-0.5 text-xs text-muted-foreground">
                Selected viewers are shown as a whitelist.
              </Popover.Description>
            </div>

            <label className="relative mt-2 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search viewers"
                className="h-9 w-full rounded-md border border-input bg-background px-3 pl-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                data-dashboard-viewer-filter-search
              />
            </label>

            <ScrollArea
              className="mt-2 max-h-72"
              contentClassName="pr-3"
              data-dashboard-viewer-filter-options
              viewportClassName="max-h-72"
            >
              <motion.button
                type="button"
                onClick={onClearViewerFilter}
                aria-pressed={!filterActive}
                className={cn(
                  "flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:outline-none",
                  !filterActive && "bg-primary/10 text-primary",
                )}
                whileHover={microHover}
                whileTap={microTap}
                transition={microTransition}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-background text-primary">
                  <Users className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    All viewers
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {formatFilterSessionCount(totalSessionCount)}
                  </span>
                </span>
                <motion.span
                  className={cn(
                    "shrink-0 text-primary",
                    filterActive && "pointer-events-none",
                  )}
                  animate={{
                    opacity: filterActive ? 0 : 1,
                    scale: filterActive ? 0.8 : 1,
                  }}
                  transition={microTransition}
                  aria-hidden="true"
                >
                  <Check className="h-4 w-4" />
                </motion.span>
              </motion.button>

              {filteredViewerOptions.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No viewers found.
                </div>
              ) : (
                filteredViewerOptions.map((option) => {
                  const selected = selectedNamesSet.has(option.normalizedName);
                  const actionLabel = selected
                    ? `Hide ${option.name} sessions`
                    : `Show ${option.name} sessions`;

                  return (
                    <motion.button
                      key={option.normalizedName}
                      type="button"
                      onClick={() => onToggleViewer(option.normalizedName)}
                      aria-pressed={selected}
                      aria-label={actionLabel}
                      className={cn(
                        "mt-1 flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:outline-none",
                        selected && "bg-primary/10 text-primary",
                      )}
                      whileHover={microHover}
                      whileTap={microTap}
                      transition={microTransition}
                    >
                      <DashboardViewerAvatar
                        name={option.name}
                        avatarUrl={option.avatarUrl}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                          {option.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {formatFilterSessionCount(option.sessionCount)}
                        </span>
                      </span>
                      <motion.span
                        className={cn(
                          "shrink-0 text-primary",
                          !selected && "pointer-events-none",
                        )}
                        animate={{
                          opacity: selected ? 1 : 0,
                          scale: selected ? 1 : 0.8,
                        }}
                        transition={microTransition}
                        aria-hidden="true"
                      >
                        <Check className="h-4 w-4" />
                      </motion.span>
                    </motion.button>
                  );
                })
              )}
            </ScrollArea>

            {filterActive && (
              <div
                className="mt-2 flex items-center justify-between gap-3 border-t border-border px-2 pt-2"
                data-dashboard-viewer-filter-summary
              >
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {hiddenSessionCount > 0
                    ? `${formatFilterSessionCount(hiddenSessionCount)} hidden`
                    : "Filtered"}
                </span>
                <motion.button
                  type="button"
                  onClick={onClearViewerFilter}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:outline-none"
                  whileHover={microHover}
                  whileTap={microTap}
                  transition={microTransition}
                >
                  <X className="h-3.5 w-3.5" />
                  Clear
                </motion.button>
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function DashboardPlaybackFilterEmptyState({
  hiddenSessionCount,
  onClearViewerFilter,
}: {
  hiddenSessionCount: number;
  onClearViewerFilter: () => void;
}) {
  return (
    <>
      <div className="bg-background mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
        <Users className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="mb-2 text-lg font-medium">
        No sessions match this viewer filter
      </h3>
      <p className="mx-auto max-w-sm text-sm text-muted-foreground">
        {formatFilterHiddenCount(hiddenSessionCount)}
      </p>
      <button
        type="button"
        onClick={onClearViewerFilter}
        className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:outline-none"
      >
        <X className="h-4 w-4" />
        Clear filter
      </button>
    </>
  );
}
