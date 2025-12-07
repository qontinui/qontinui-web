/**
 * State Builder Types
 *
 * Types for enhanced state organization and management
 */

import type { State } from "@/contexts/automation-context";

/**
 * Group/folder for organizing states
 */
export interface StateGroup {
  /** Unique group identifier */
  id: string;

  /** Group name */
  name: string;

  /** Group color (hex color code) */
  color?: string;

  /** Parent group ID (null for root groups) */
  parentId?: string | null;

  /** Whether group is expanded in UI */
  expanded?: boolean;

  /** Sort order within parent */
  order: number;

  /** Icon name from lucide-react */
  icon?: string;

  /** Creation timestamp */
  createdAt?: Date;

  /** Last modified timestamp */
  updatedAt?: Date;
}

/**
 * State with additional metadata for organization
 */
export interface StateWithMetadata extends State {
  /** Parent group ID */
  groupId?: string | null;

  /** Tags for categorization */
  tags?: string[];

  /** Complexity score (calculated) */
  complexity?: number;

  /** Creation timestamp */
  createdAt?: Date;

  /** Last modified timestamp */
  modifiedAt?: Date;

  /** State color override */
  color?: string;

  /** Custom notes */
  notes?: string;

  /** Whether state is archived */
  archived?: boolean;

  /** Usage count (how many workflows reference it) */
  usageCount?: number;
}

/**
 * Template for creating states
 */
export interface StateTemplate {
  /** Template ID */
  id: string;

  /** Template name */
  name: string;

  /** Template description */
  description: string;

  /** The template state structure */
  template: Partial<State>;

  /** Template thumbnail/preview */
  thumbnail?: string;

  /** Template category */
  category?: string;

  /** Creation timestamp */
  createdAt?: Date;

  /** Tags */
  tags?: string[];
}

/**
 * Search and filter configuration
 */
export interface StateSearchFilter {
  /** Text search query */
  query?: string;

  /** Selected group IDs */
  groupIds?: string[];

  /** Selected tags */
  tags?: string[];

  /** Tag matching mode */
  tagOperator?: "AND" | "OR";

  /** Has images filter */
  hasImages?: boolean | null;

  /** Has transitions filter */
  hasTransitions?: boolean | null;

  /** Has regions filter */
  hasRegions?: boolean | null;

  /** Has locations filter */
  hasLocations?: boolean | null;

  /** Minimum complexity */
  minComplexity?: number;

  /** Maximum complexity */
  maxComplexity?: number;

  /** Created date range */
  createdDateRange?: {
    from?: Date;
    to?: Date;
  };

  /** Modified date range */
  modifiedDateRange?: {
    from?: Date;
    to?: Date;
  };

  /** Show archived states */
  showArchived?: boolean;
}

/**
 * Saved search filter
 */
export interface SavedStateFilter {
  /** Filter ID */
  id: string;

  /** Filter name */
  name: string;

  /** The saved filter */
  filter: StateSearchFilter;

  /** Creation timestamp */
  createdAt: Date;

  /** Is this a favorite filter */
  favorite?: boolean;
}

/**
 * Bulk operation payload
 */
export interface BulkOperationPayload {
  /** State IDs to operate on */
  stateIds: string[];

  /** Operation type */
  operation: "move" | "tag" | "delete" | "export" | "duplicate" | "archive";

  /** Operation-specific data */
  data?: {
    /** Target group ID (for move) */
    groupId?: string | null;

    /** Tags to add/remove */
    tags?: string[];

    /** Export format */
    format?: "json" | "yaml";

    /** Archive state */
    archived?: boolean;
  };
}

/**
 * State comparison result
 */
export interface StateComparison {
  /** First state ID */
  stateId1: string;

  /** Second state ID */
  stateId2: string;

  /** Similarity score (0-1) */
  similarity: number;

  /** Differences */
  differences: {
    /** Different StateImages */
    images?: {
      only1: string[];
      only2: string[];
      different: string[];
    };

    /** Different regions */
    regions?: {
      only1: string[];
      only2: string[];
      different: string[];
    };

    /** Different locations */
    locations?: {
      only1: string[];
      only2: string[];
      different: string[];
    };

    /** Different strings */
    strings?: {
      only1: string[];
      only2: string[];
      different: string[];
    };
  };
}

/**
 * State validation issue
 */
export interface StateValidationIssue {
  /** Issue type */
  type: "error" | "warning" | "info";

  /** Issue code */
  code: string;

  /** Human-readable message */
  message: string;

  /** State element affected (if applicable) */
  element?: {
    type: "stateImage" | "region" | "location" | "string";
    id: string;
    name?: string;
  };

  /** Suggested fix */
  suggestion?: string;
}

/**
 * State usage information
 */
export interface StateUsageInfo {
  /** Workflows that reference this state */
  workflows: Array<{
    id: string;
    name: string;
    category?: string;
  }>;

  /** Transitions that reference this state */
  transitions: Array<{
    id: string;
    type: "incoming" | "outgoing";
  }>;

  /** Total usage count */
  totalUsageCount: number;
}

/**
 * State analytics data
 */
export interface StateAnalytics {
  /** State ID */
  stateId: string;

  /** Complexity score */
  complexity: number;

  /** Number of patterns across all StateImages */
  totalPatterns: number;

  /** Number of search regions */
  totalSearchRegions: number;

  /** Has validation issues */
  hasIssues: boolean;

  /** Issue count by severity */
  issueCount: {
    errors: number;
    warnings: number;
    info: number;
  };

  /** Usage count */
  usageCount: number;

  /** Last modified date */
  lastModified?: Date;
}

/**
 * Complexity level
 */
export type ComplexityLevel = "low" | "medium" | "high" | "very-high";

/**
 * Get complexity level from score
 */
export function getComplexityLevel(score: number): ComplexityLevel {
  if (score < 5) return "low";
  if (score < 15) return "medium";
  if (score < 30) return "high";
  return "very-high";
}

/**
 * Get complexity color
 */
export function getComplexityColor(level: ComplexityLevel): string {
  switch (level) {
    case "low":
      return "text-green-500 border-green-500";
    case "medium":
      return "text-yellow-500 border-yellow-500";
    case "high":
      return "text-orange-500 border-orange-500";
    case "very-high":
      return "text-red-500 border-red-500";
  }
}
