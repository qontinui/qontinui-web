"use client";

import {
  FileCode,
  Layers,
  Image as ImageIcon,
  GitBranch,
  TestTube,
  BookOpen,
} from "lucide-react";
import { MetricCard } from "./metric-card";
import type { ProjectData } from "../_lib/types";

interface MetricsOverviewProps {
  data: ProjectData;
}

export function MetricsOverview({ data }: MetricsOverviewProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      <MetricCard
        icon={FileCode}
        label="Total Workflows"
        value={data.metrics.totalWorkflows}
        color="var(--brand-primary)"
        trend={data.metrics.trends.workflows}
      />
      <MetricCard
        icon={Layers}
        label="Total States"
        value={data.metrics.totalStates}
        color="var(--brand-secondary)"
        trend={data.metrics.trends.states}
      />
      <MetricCard
        icon={ImageIcon}
        label="Total Images"
        value={data.metrics.totalImages}
        color="var(--brand-success)"
        trend={data.metrics.trends.images}
      />
      <MetricCard
        icon={GitBranch}
        label="Total Transitions"
        value={data.metrics.totalTransitions}
        color="var(--warning)"
        trend={data.metrics.trends.transitions}
      />
      <MetricCard
        icon={TestTube}
        label="Test Coverage"
        value={`${data.metrics.testCoverage.toFixed(1)}%`}
        color="var(--error)"
      />
      <MetricCard
        icon={BookOpen}
        label="Doc Coverage"
        value={`${data.metrics.docCoverage.toFixed(1)}%`}
        color="var(--text-muted)"
      />
    </div>
  );
}
