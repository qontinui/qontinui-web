"use client";

import {
  FileCode,
  Layers,
  Image as ImageIcon,
  GitBranch,
  TestTube,
  BookOpen,
} from "lucide-react";
import { MetricCard } from "@/components/common/_components/MetricCard";
import type { ProjectData } from "../_lib/types";

interface MetricsOverviewProps {
  data: ProjectData;
}

export function MetricsOverview({ data }: MetricsOverviewProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      <MetricCard
        icon={FileCode}
        title="Total Workflows"
        value={data.metrics.totalWorkflows}
        color="var(--brand-primary)"
        colorValue
        trend={data.metrics.trends.workflows}
      />
      <MetricCard
        icon={Layers}
        title="Total States"
        value={data.metrics.totalStates}
        color="var(--brand-secondary)"
        colorValue
        trend={data.metrics.trends.states}
      />
      <MetricCard
        icon={ImageIcon}
        title="Total Images"
        value={data.metrics.totalImages}
        color="var(--brand-success)"
        colorValue
        trend={data.metrics.trends.images}
      />
      <MetricCard
        icon={GitBranch}
        title="Total Transitions"
        value={data.metrics.totalTransitions}
        color="var(--warning)"
        colorValue
        trend={data.metrics.trends.transitions}
      />
      <MetricCard
        icon={TestTube}
        title="Test Coverage"
        value={`${data.metrics.testCoverage.toFixed(1)}%`}
        color="var(--error)"
        colorValue
      />
      <MetricCard
        icon={BookOpen}
        title="Doc Coverage"
        value={`${data.metrics.docCoverage.toFixed(1)}%`}
        color="var(--text-muted)"
        colorValue
      />
    </div>
  );
}
