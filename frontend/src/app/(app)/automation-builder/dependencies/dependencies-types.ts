import type {
  DependencyNode,
  ImpactAnalysis,
} from "@/services/workflow-dependency-analyzer";
import type { Workflow } from "@/lib/action-schema/action-types";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  type LucideIcon,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

export interface FilterState {
  folders: string[];
  tags: string[];
  categories: string[];
  showOnlyIssues: boolean;
  showCriticalPath: boolean;
  selectedWorkflowId: string | null;
  viewMode: "all" | "dependencies" | "dependents";
}

export interface SelectedWorkflowData {
  workflow: Workflow;
  node: DependencyNode;
  impact: ImpactAnalysis;
}

// ============================================================================
// Helper Functions
// ============================================================================

export function getNodeColor(node: DependencyNode): string {
  if (node.isCircular) return "#ef4444"; // red - circular
  if (node.inDegree === 0) return "#10b981"; // green - leaf/unused
  if (node.inDegree >= 3) return "#f59e0b"; // amber - critical
  return "#3b82f6"; // blue - normal
}

interface ImpactBadgeConfig {
  variant: "secondary" | "default" | "destructive";
  label: string;
  icon: LucideIcon;
}

export function getImpactBadge(
  level: "low" | "medium" | "high" | "critical"
): ImpactBadgeConfig {
  const variants: Record<
    "low" | "medium" | "high" | "critical",
    ImpactBadgeConfig
  > = {
    low: { variant: "secondary", label: "Low", icon: Info },
    medium: {
      variant: "default",
      label: "Medium",
      icon: AlertTriangle,
    },
    high: { variant: "default", label: "High", icon: AlertCircle },
    critical: {
      variant: "destructive",
      label: "Critical",
      icon: AlertCircle,
    },
  };
  return variants[level];
}
