"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import type { AnnotationSource, ReviewStatus } from "@/types/dataset";
import {
  SOURCE_COLORS,
  REVIEW_STATUS_COLORS,
  ANNOTATION_SOURCES,
  REVIEW_STATUSES,
} from "../dataset-viewer-utils";
import type { FilterSidebarProps } from "../dataset-viewer-types";

export function FilterSidebar({
  filters,
  onSourceFilterChange,
  onReviewStatusFilterChange,
  onFiltersChange,
}: FilterSidebarProps) {
  return (
    <div className="col-span-12 lg:col-span-2 overflow-y-auto">
      <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/50">
        Filters
      </div>
      <div className="p-4 space-y-4">
        {/* Source Filter */}
        <div>
          <p className="text-xs font-medium">Source</p>
          <div className="mt-2 space-y-2">
            {ANNOTATION_SOURCES.map((source: AnnotationSource) => (
              <div key={source} className="flex items-center gap-2">
                <Checkbox
                  id={`source-${source}`}
                  checked={filters.sources?.includes(source)}
                  onCheckedChange={(checked) =>
                    onSourceFilterChange(source, checked as boolean)
                  }
                />
                <label
                  htmlFor={`source-${source}`}
                  className="text-xs flex items-center gap-1"
                >
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: SOURCE_COLORS[source] }}
                  />
                  {source.replace("_", " ")}
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Confidence Filter */}
        <div>
          <p className="text-xs font-medium">
            Confidence: {(filters.confidence_min || 0).toFixed(2)} -{" "}
            {(filters.confidence_max || 1).toFixed(2)}
          </p>
          <Slider
            className="mt-2"
            min={0}
            max={1}
            step={0.05}
            value={[filters.confidence_min || 0, filters.confidence_max || 1]}
            onValueChange={([min, max]) =>
              onFiltersChange((prev) => ({
                ...prev,
                confidence_min: min,
                confidence_max: max,
              }))
            }
          />
        </div>

        {/* Review Status Filter */}
        <div>
          <p className="text-xs font-medium">Review Status</p>
          <div className="mt-2 space-y-2">
            {REVIEW_STATUSES.map((status: ReviewStatus) => (
              <div key={status} className="flex items-center gap-2">
                <Checkbox
                  id={`status-${status}`}
                  checked={filters.review_statuses?.includes(status)}
                  onCheckedChange={(checked) =>
                    onReviewStatusFilterChange(status, checked as boolean)
                  }
                />
                <label
                  htmlFor={`status-${status}`}
                  className="text-xs flex items-center gap-1"
                >
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: REVIEW_STATUS_COLORS[status],
                    }}
                  />
                  {status}
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
