"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { XCircle, AlertTriangle, Info } from "lucide-react";
import type { HealthIssue } from "../_lib/types";

interface HealthIssuesListProps {
  issues: HealthIssue[];
}

export function HealthIssuesList({ issues }: HealthIssuesListProps) {
  const router = useRouter();

  const getIssueIcon = (type: HealthIssue["type"]) => {
    switch (type) {
      case "error":
        return XCircle;
      case "warning":
        return AlertTriangle;
      case "info":
        return Info;
    }
  };

  const getIssueColor = (type: HealthIssue["type"]) => {
    switch (type) {
      case "error":
        return "var(--error)";
      case "warning":
        return "var(--warning)";
      case "info":
        return "var(--brand-primary)";
    }
  };

  return (
    <div className="space-y-2">
      {issues.map((issue) => {
        const Icon = getIssueIcon(issue.type);
        const color = getIssueColor(issue.type);

        return (
          <div
            key={issue.id}
            className="p-3 rounded-lg border border-border-subtle/50 hover:border-border-default transition-all cursor-pointer"
            style={{ backgroundColor: `${color}08` }}
            onClick={() => router.push(issue.link)}
          >
            <div className="flex items-start gap-3">
              <Icon
                className="w-4 h-4 mt-0.5 flex-shrink-0"
                style={{ color }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-medium">{issue.title}</p>
                  <Badge
                    variant="outline"
                    style={{
                      backgroundColor: `${color}20`,
                      borderColor: `${color}40`,
                      color,
                    }}
                  >
                    {issue.count}
                  </Badge>
                </div>
                <p className="text-xs text-text-muted mb-2">
                  {issue.description}
                </p>
                {issue.affectedResources.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {issue.affectedResources.slice(0, 3).map((resource) => (
                      <Badge
                        key={resource}
                        variant="outline"
                        className="text-xs bg-surface-hover/50 border-border-default"
                      >
                        {resource}
                      </Badge>
                    ))}
                    {issue.affectedResources.length > 3 && (
                      <Badge
                        variant="outline"
                        className="text-xs bg-surface-hover/50 border-border-default"
                      >
                        +{issue.affectedResources.length - 3} more
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
