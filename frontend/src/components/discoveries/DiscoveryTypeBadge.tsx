"use client";

import { Badge } from "@/components/ui/badge";
import { DiscoveryTypeIcon, getDiscoveryTypeColor } from "./DiscoveryTypeIcon";
import type { DiscoveryType } from "@/types/discoveries";
import { cn } from "@/lib/utils";

interface DiscoveryTypeBadgeProps {
  type: DiscoveryType;
  className?: string;
}

const discoveryTypeLabels: Record<DiscoveryType, string> = {
  new_element: "New Element",
  new_transition: "New Transition",
  timing_update: "Timing Update",
  flaky_detection: "Flaky Detection",
  unexpected_element: "Unexpected Element",
};

export function DiscoveryTypeBadge({
  type,
  className,
}: DiscoveryTypeBadgeProps) {
  const color = getDiscoveryTypeColor(type);
  const label = discoveryTypeLabels[type] || type;

  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 border-current bg-current/10", className)}
      style={{ color, borderColor: `${color}50` }}
    >
      <DiscoveryTypeIcon type={type} size={12} />
      <span>{label}</span>
    </Badge>
  );
}
