/**
 * Shared types, constants, and helpers for the Workflow Browser.
 */

import React from "react";
import { Workflow } from "../../../lib/action-schema/action-types";
import {
  Clock,
  AlertTriangle,
  BookOpen,
  TrendingUp,
  LayoutGrid,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

export interface EnhancedWorkflowItem {
  key: string;
  workflow: Workflow;
  lastModified?: Date;
  snapshotCount: number;
  folderId?: string | null;
  folderPath?: string[];
  complexity?: number;
  complexityRating?: "low" | "medium" | "high" | "very-high";
  testCoverage?: number;
  hasTests?: boolean;
  hasDocumentation?: boolean;
  lastRun?: string;
  successRate?: number;
  avgDuration?: number;
  failedLastRun?: boolean;
  hasDependencies?: boolean;
  recentlyModified?: boolean;
}

export type ViewMode = "list" | "grid" | "compact";
export type SortBy =
  | "date"
  | "name"
  | "actions"
  | "complexity"
  | "successRate"
  | "lastRun"
  | "modified";
export type SortOrder = "asc" | "desc";
export type GroupBy = "none" | "folder" | "category" | "tag" | "complexity";

export interface WorkflowBrowserProps {
  onOpen: (workflow: Workflow) => void;
  onClose: () => void;
  open: boolean;
}

export interface ColumnConfig {
  id: string;
  label: string;
  visible: boolean;
  width?: number;
}

export interface QuickFilter {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  filter: (item: EnhancedWorkflowItem) => boolean;
}

export interface WorkflowGroup {
  key: string;
  label: string;
  items: EnhancedWorkflowItem[];
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "name", label: "Name", visible: true, width: 250 },
  { id: "folder", label: "Folder", visible: true, width: 150 },
  { id: "complexity", label: "Complexity", visible: true, width: 120 },
  { id: "testCoverage", label: "Test Coverage", visible: false, width: 120 },
  { id: "lastRun", label: "Last Run", visible: false, width: 150 },
  { id: "successRate", label: "Success Rate", visible: false, width: 120 },
  { id: "actions", label: "Actions", visible: true, width: 100 },
  { id: "modified", label: "Modified", visible: true, width: 150 },
];

export const QUICK_FILTERS: QuickFilter[] = [
  {
    id: "all",
    label: "All Workflows",
    icon: LayoutGrid,
    filter: () => true,
  },
  {
    id: "recent",
    label: "Recent",
    icon: Clock,
    filter: (item) => item.recentlyModified || false,
  },
  {
    id: "noTests",
    label: "No Tests",
    icon: AlertTriangle,
    filter: (item) => !item.hasTests,
  },
  {
    id: "noDocs",
    label: "No Documentation",
    icon: BookOpen,
    filter: (item) => !item.hasDocumentation,
  },
  {
    id: "highComplexity",
    label: "High Complexity",
    icon: TrendingUp,
    filter: (item) =>
      item.complexityRating === "high" || item.complexityRating === "very-high",
  },
  {
    id: "errors",
    label: "Errors",
    icon: AlertTriangle,
    filter: (item) => item.failedLastRun || false,
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a workflow was modified in the last 7 days
 */
export function isRecentlyModified(date?: Date): boolean {
  if (!date) return false;
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  return date > sevenDaysAgo;
}

/**
 * Format date to relative time
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}
