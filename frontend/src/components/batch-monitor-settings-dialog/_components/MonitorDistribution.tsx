"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";

interface MonitorDistributionProps {
  monitorDistribution: Record<number, number>;
}

export function MonitorDistribution({
  monitorDistribution,
}: MonitorDistributionProps) {
  const entries = Object.entries(monitorDistribution).sort(
    ([a], [b]) => Number(a) - Number(b)
  );

  return (
    <div className="bg-surface-canvas rounded-lg p-4 space-y-2">
      <h4 className="text-sm font-medium text-text-secondary">
        Current Monitor Distribution
      </h4>
      <div className="flex flex-wrap gap-2">
        {entries.length > 0 ? (
          entries.map(([monitor, count]) => (
            <Badge
              key={monitor}
              variant="secondary"
              className="bg-surface-raised"
            >
              {monitor === "0"
                ? "Primary"
                : monitor === "1"
                  ? "Left"
                  : monitor === "2"
                    ? "Right"
                    : `Monitor ${monitor}`}
              : {count} state image(s)
            </Badge>
          ))
        ) : (
          <span className="text-sm text-text-muted">
            No monitor settings configured yet
          </span>
        )}
      </div>
    </div>
  );
}
