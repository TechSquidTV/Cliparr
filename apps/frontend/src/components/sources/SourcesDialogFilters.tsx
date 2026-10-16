import { Search } from "lucide-react";
import type { RefObject } from "react";

import { formatProviderName } from "#/components/providers/ProviderGlyph";
import { sourceFieldLabelClasses } from "#/components/sources/sourcesPresentation";
import type { SourceFilter } from "#/components/sources/sourcesTypes";
import type { SourceCounts } from "#/components/sources/sourcesTypes";
import { textInputClassName } from "#/components/ui/control-styles";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { cn } from "#/lib/cn";

const sourceFilterButtonClasses =
  "control-focus inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-ui-label font-medium normal-case tracking-normal transition-colors";
const sourceFilterOptions = [
  ["all", "All"],
  ["enabled", "Enabled"],
  ["disabled", "Disabled"],
  ["attention", "Needs attention"],
] as const satisfies readonly [SourceFilter, string][];

interface SourcesDialogFiltersProperties {
  searchInputRef: RefObject<HTMLInputElement | null>;
  query: string;
  providerFilter: string;
  providerOptions: string[];
  statusFilter: SourceFilter;
  counts: SourceCounts;
  onQueryChange: (value: string) => void;
  onProviderFilterChange: (value: string) => void;
  onStatusFilterChange: (value: SourceFilter) => void;
}

export function SourcesDialogFilters({
  searchInputRef,
  query,
  providerFilter,
  providerOptions,
  statusFilter,
  counts,
  onQueryChange,
  onProviderFilterChange,
  onStatusFilterChange,
}: SourcesDialogFiltersProperties) {
  return (
    <div className="border-b border-border bg-background px-4 py-3 sm:px-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-1 flex-col gap-2 lg:flex-row">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search by source name, URL, provider, or platform"
              className={cn(textInputClassName(), "pl-9")}
            />
          </label>

          <Select
            value={providerFilter}
            items={[
              { value: "all", label: "All providers" },
              ...providerOptions.map((providerId) => ({
                value: providerId,
                label: formatProviderName(providerId),
              })),
            ]}
            onValueChange={(value) => {
              if (value !== null) {
                onProviderFilterChange(value);
              }
            }}
          >
            <SelectTrigger aria-label="Provider" className="lg:w-52">
              <span className={sourceFieldLabelClasses}>Provider</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providerOptions.map((providerId) => (
                <SelectItem key={providerId} value={providerId}>
                  {formatProviderName(providerId)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-1 rounded-md border border-border bg-card p-1">
          {sourceFilterOptions.map(([value, label]) => {
            const isActive = statusFilter === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onStatusFilterChange(value)}
                className={cn(
                  sourceFilterButtonClasses,
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {label}
                <span className="inline-block min-w-[3ch] text-right font-mono text-ui-micro tabular-nums opacity-80">
                  {counts[value]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
