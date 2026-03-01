"use client";

import { ImageIcon, Tag, CheckCircle2 } from "lucide-react";
import type { StatisticsBarProps } from "../dataset-viewer-types";

export function StatisticsBar({ statistics }: StatisticsBarProps) {
  return (
    <div className="grid grid-cols-6 gap-px bg-border shrink-0">
      <div className="bg-background px-4 py-3">
        <div className="flex items-center gap-1.5 mb-1">
          <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            Images
          </span>
        </div>
        <div
          data-content-role="metric"
          data-content-label="total images"
          className="text-xl font-semibold tabular-nums"
        >
          {statistics.total_images}
        </div>
      </div>
      <div className="bg-background px-4 py-3">
        <div className="flex items-center gap-1.5 mb-1">
          <Tag className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            Annotations
          </span>
        </div>
        <div
          data-content-role="metric"
          data-content-label="total annotations"
          className="text-xl font-semibold tabular-nums"
        >
          {statistics.total_annotations}
        </div>
      </div>
      <div className="bg-background px-4 py-3">
        <div className="flex items-center gap-1.5 mb-1">
          <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            Reviewed
          </span>
        </div>
        <div
          data-content-role="metric"
          data-content-label="reviewed images"
          className="text-xl font-semibold tabular-nums"
        >
          {statistics.reviewed_images}
        </div>
      </div>
      <div className="bg-background px-4 py-3">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">
          User Clicks
        </span>
        <div
          data-content-role="metric"
          data-content-label="user clicks count"
          className="text-xl font-semibold tabular-nums text-green-500"
        >
          {statistics.by_source.user_click || 0}
        </div>
      </div>
      <div className="bg-background px-4 py-3">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">
          Smart Analysis
        </span>
        <div
          data-content-role="metric"
          data-content-label="smart analysis count"
          className="text-xl font-semibold tabular-nums text-blue-500"
        >
          {statistics.by_source.smart_click_analysis || 0}
        </div>
      </div>
      <div className="bg-background px-4 py-3">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">
          Template Match
        </span>
        <div
          data-content-role="metric"
          data-content-label="template match count"
          className="text-xl font-semibold tabular-nums text-orange-500"
        >
          {statistics.by_source.template_matching || 0}
        </div>
      </div>
    </div>
  );
}
