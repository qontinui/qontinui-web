/**
 * Deficiency (Bug) Management Types
 *
 * Type definitions for deficiency tracking, workflow, and collaboration
 */

export enum DeficiencySeverity {
  CRITICAL = "critical",
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
  INFO = "info",
}

export enum DeficiencyType {
  CRASH = "crash",
  TIMEOUT = "timeout",
  VISUAL = "visual",
  FUNCTIONAL = "functional",
  PERFORMANCE = "performance",
  DATA = "data",
  ACCESSIBILITY = "accessibility",
  SECURITY = "security",
}

export enum DeficiencyStatus {
  NEW = "new",
  ACKNOWLEDGED = "acknowledged",
  INVESTIGATING = "investigating",
  FIXED = "fixed",
  CLOSED = "closed",
  WONT_FIX = "wont_fix",
}

export interface Deficiency {
  id: string;
  test_run_id: string;
  transition_execution_id?: string;

  // Classification
  severity: DeficiencySeverity;
  deficiency_type: DeficiencyType;
  category?: string;

  // Description
  title: string;
  description: string;

  // Visual evidence
  screenshot_urls: string[];
  video_url?: string;

  // Reproduction
  reproduction_steps: string[];
  reproduction_rate?: number;
  reproducible: boolean;

  // Context
  environment_info: {
    os?: string;
    browser?: string;
    screen_resolution?: string;
    [key: string]: unknown;
  };
  preconditions: {
    [key: string]: unknown;
  };

  // Lifecycle
  status: DeficiencyStatus;
  resolution?: string;

  // Assignment
  assigned_to_user_id?: string;
  assigned_at?: string;

  // Tracking
  first_seen_at: string;
  last_seen_at: string;
  occurrence_count: number;

  // External integration
  external_ticket_id?: string;
  external_ticket_url?: string;

  // Metadata
  tags: string[];
  custom_fields: {
    [key: string]: unknown;
  };

  // Audit
  created_at: string;
  updated_at: string;
  resolved_at?: string;
}

export interface DeficiencyComment {
  id: string;
  deficiency_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  content: string;
  mentions: string[]; // User IDs mentioned
  attachments: {
    name: string;
    url: string;
    size: number;
    type: string;
  }[];
  created_at: string;
  updated_at: string;
}

export interface DeficiencyActivity {
  id: string;
  deficiency_id: string;
  user_id: string;
  user_name: string;
  action:
    | "created"
    | "updated"
    | "status_changed"
    | "assigned"
    | "commented"
    | "resolved";
  details: {
    field?: string;
    old_value?: unknown;
    new_value?: unknown;
    [key: string]: unknown;
  };
  created_at: string;
}

export interface DeficiencyFilters {
  severity?: DeficiencySeverity[];
  deficiency_type?: DeficiencyType[];
  status?: DeficiencyStatus[];
  assigned_to?: string[];
  tags?: string[];
  search?: string;
  date_from?: string;
  date_to?: string;
}

export interface DeficiencyExportOptions {
  format: "pdf" | "csv" | "json";
  include_comments?: boolean;
  include_activity?: boolean;
  include_screenshots?: boolean;
  template?: string;
}

// Workflow transition rules
export const WORKFLOW_TRANSITIONS: Record<
  DeficiencyStatus,
  DeficiencyStatus[]
> = {
  [DeficiencyStatus.NEW]: [
    DeficiencyStatus.ACKNOWLEDGED,
    DeficiencyStatus.WONT_FIX,
  ],
  [DeficiencyStatus.ACKNOWLEDGED]: [
    DeficiencyStatus.INVESTIGATING,
    DeficiencyStatus.WONT_FIX,
  ],
  [DeficiencyStatus.INVESTIGATING]: [
    DeficiencyStatus.FIXED,
    DeficiencyStatus.WONT_FIX,
  ],
  [DeficiencyStatus.FIXED]: [
    DeficiencyStatus.CLOSED,
    DeficiencyStatus.INVESTIGATING,
  ],
  [DeficiencyStatus.CLOSED]: [DeficiencyStatus.INVESTIGATING],
  [DeficiencyStatus.WONT_FIX]: [DeficiencyStatus.INVESTIGATING],
};

// Status display configuration
export const STATUS_CONFIG: Record<
  DeficiencyStatus,
  {
    label: string;
    color: string;
    bgColor: string;
    icon: string;
  }
> = {
  [DeficiencyStatus.NEW]: {
    label: "New",
    color: "text-blue-600",
    bgColor: "bg-blue-100 border-blue-200",
    icon: "AlertCircle",
  },
  [DeficiencyStatus.ACKNOWLEDGED]: {
    label: "Acknowledged",
    color: "text-purple-600",
    bgColor: "bg-purple-100 border-purple-200",
    icon: "Eye",
  },
  [DeficiencyStatus.INVESTIGATING]: {
    label: "Investigating",
    color: "text-yellow-600",
    bgColor: "bg-yellow-100 border-yellow-200",
    icon: "Search",
  },
  [DeficiencyStatus.FIXED]: {
    label: "Fixed",
    color: "text-green-600",
    bgColor: "bg-green-100 border-green-200",
    icon: "CheckCircle",
  },
  [DeficiencyStatus.CLOSED]: {
    label: "Closed",
    color: "text-gray-600",
    bgColor: "bg-gray-100 border-gray-200",
    icon: "Archive",
  },
  [DeficiencyStatus.WONT_FIX]: {
    label: "Won't Fix",
    color: "text-red-600",
    bgColor: "bg-red-100 border-red-200",
    icon: "XCircle",
  },
};

// Severity display configuration
export const SEVERITY_CONFIG: Record<
  DeficiencySeverity,
  {
    label: string;
    color: string;
    bgColor: string;
  }
> = {
  [DeficiencySeverity.CRITICAL]: {
    label: "Critical",
    color: "text-red-700",
    bgColor: "bg-red-100 border-red-300",
  },
  [DeficiencySeverity.HIGH]: {
    label: "High",
    color: "text-orange-700",
    bgColor: "bg-orange-100 border-orange-300",
  },
  [DeficiencySeverity.MEDIUM]: {
    label: "Medium",
    color: "text-yellow-700",
    bgColor: "bg-yellow-100 border-yellow-300",
  },
  [DeficiencySeverity.LOW]: {
    label: "Low",
    color: "text-blue-700",
    bgColor: "bg-blue-100 border-blue-300",
  },
  [DeficiencySeverity.INFO]: {
    label: "Info",
    color: "text-gray-700",
    bgColor: "bg-gray-100 border-gray-300",
  },
};
