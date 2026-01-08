"use client";

import {
  Plus,
  ArrowRightLeft,
  Clock,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";
import type { DiscoveryType } from "@/types/discoveries";

interface DiscoveryTypeIconProps {
  type: DiscoveryType;
  size?: number;
  className?: string;
}

const discoveryTypeConfig: Record<
  DiscoveryType,
  {
    icon: React.ElementType;
    color: string;
  }
> = {
  new_element: {
    icon: Plus,
    color: "hsl(var(--brand-success))",
  },
  new_transition: {
    icon: ArrowRightLeft,
    color: "hsl(var(--brand-primary))",
  },
  timing_update: {
    icon: Clock,
    color: "#FFD700",
  },
  flaky_detection: {
    icon: AlertTriangle,
    color: "#FF8C00",
  },
  unexpected_element: {
    icon: HelpCircle,
    color: "#FF6B6B",
  },
};

export function DiscoveryTypeIcon({
  type,
  size = 16,
  className,
}: DiscoveryTypeIconProps) {
  const config = discoveryTypeConfig[type];
  const Icon = config?.icon || HelpCircle;
  const color = config?.color || "#888";

  return <Icon size={size} style={{ color }} className={className} />;
}

export function getDiscoveryTypeColor(type: DiscoveryType): string {
  return discoveryTypeConfig[type]?.color || "#888";
}
