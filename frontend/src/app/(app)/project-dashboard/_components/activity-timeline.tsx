"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus,
  FileText,
  Trash2,
  Upload,
  Download,
  TestTube,
  FileCode,
  Layers,
  Image as ImageIcon,
  GitBranch,
} from "lucide-react";
import type { ActivityEvent } from "../_lib/types";

interface ActivityTimelineProps {
  activities: ActivityEvent[];
}

function getActivityIcon(type: ActivityEvent["type"]) {
  switch (type) {
    case "created":
      return Plus;
    case "modified":
      return FileText;
    case "deleted":
      return Trash2;
    case "imported":
      return Upload;
    case "exported":
      return Download;
    case "tested":
      return TestTube;
  }
}

function getActivityColor(type: ActivityEvent["type"]) {
  switch (type) {
    case "created":
      return "var(--brand-success)";
    case "modified":
      return "var(--brand-primary)";
    case "deleted":
      return "var(--error)";
    case "imported":
      return "var(--warning)";
    case "exported":
      return "var(--brand-secondary)";
    case "tested":
      return "var(--text-muted)";
  }
}

function getResourceTypeIcon(type: ActivityEvent["resourceType"]) {
  switch (type) {
    case "workflow":
      return FileCode;
    case "state":
      return Layers;
    case "image":
      return ImageIcon;
    case "transition":
      return GitBranch;
  }
}

function getRelativeTime(date: Date) {
  const now = new Date();
  const diffInMinutes = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60)
  );

  if (diffInMinutes < 1) return "Just now";
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours}h ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays}d ago`;
  return date.toLocaleDateString();
}

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  return (
    <ScrollArea className="h-[400px] pr-4">
      <div className="space-y-2">
        {activities.slice(0, 20).map((activity) => {
          const Icon = getActivityIcon(activity.type);
          const ResourceIcon = getResourceTypeIcon(activity.resourceType);
          const color = getActivityColor(activity.type);

          return (
            <div
              key={activity.id}
              className="flex items-start gap-3 p-3 rounded-lg hover:bg-surface-hover/30 transition-colors cursor-pointer"
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${color}20` }}
              >
                <Icon className="w-4 h-4" style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {activity.type.charAt(0).toUpperCase() +
                    activity.type.slice(1)}{" "}
                  <span className="text-brand-primary">
                    {activity.resourceName}
                  </span>
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <ResourceIcon className="w-3 h-3 text-text-muted" />
                  <span className="text-xs text-text-muted">
                    {activity.resourceType}
                  </span>
                  <span className="text-text-muted">•</span>
                  <span className="text-xs text-text-muted">
                    {getRelativeTime(activity.timestamp)}
                  </span>
                  {activity.user && (
                    <>
                      <span className="text-text-muted">•</span>
                      <span className="text-xs text-text-muted">
                        {activity.user}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
