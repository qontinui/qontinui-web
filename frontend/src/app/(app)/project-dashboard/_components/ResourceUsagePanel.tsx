"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileCode,
  Layers,
  Image as ImageIcon,
  GitBranch,
  TrendingUp,
  BarChart3,
} from "lucide-react";
import dynamic from "next/dynamic";

const ResourceOverviewTabs = dynamic(
  () =>
    import("./resource-overview-tabs").then((m) => ({
      default: m.ResourceOverviewTabs,
    })),
  { ssr: false }
);
import type { ProjectData } from "../_lib/types";

interface ResourceUsagePanelProps {
  data: ProjectData;
}

const RESOURCE_ICONS = {
  workflow: FileCode,
  state: Layers,
  image: ImageIcon,
  transition: GitBranch,
} as const;

const RESOURCE_COLORS = {
  workflow: "var(--brand-primary)",
  state: "var(--brand-secondary)",
  image: "var(--brand-success)",
  transition: "var(--warning)",
} as const;

export function ResourceUsagePanel({ data }: ResourceUsagePanelProps) {
  return (
    <div className="space-y-6">
      <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-brand-secondary" />
            Resource Overview
          </CardTitle>
          <CardDescription>
            Detailed statistics by resource type
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResourceOverviewTabs data={data} />
        </CardContent>
      </Card>

      <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-brand-success" />
            Most Used Resources
          </CardTitle>
          <CardDescription>Top 5 resources by usage count</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {data.resourceUsage.map((resource) => {
              const Icon = RESOURCE_ICONS[resource.type];
              const color = RESOURCE_COLORS[resource.type];

              return (
                <div
                  key={resource.id}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-surface-hover/30 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${color}20` }}
                    >
                      <Icon className="w-4 h-4" style={{ color }} />
                    </div>
                    <div>
                      <p className="font-medium text-sm" style={{ color }}>
                        {resource.name}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge
                          variant="outline"
                          className="text-xs bg-surface-hover/50 border-border-default"
                        >
                          {resource.type}
                        </Badge>
                        {resource.lastUsed && (
                          <span className="text-xs text-text-muted">
                            Last used: {resource.lastUsed}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm">
                      {resource.usageCount.toLocaleString()}
                    </p>
                    <p className="text-xs text-text-muted">uses</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
