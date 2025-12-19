/**
 * Detected Issue Types
 *
 * Type definitions for issues detected during AI-assisted automation sessions.
 * These issues are synced from the qontinui-runner to the web backend.
 */

export enum IssueSeverity {
  CRITICAL = "critical",
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
}

export enum IssueType {
  ERROR = "error",
  WARNING = "warning",
  EXCEPTION = "exception",
  TYPE_ERROR = "type_error",
  RUNTIME_ERROR = "runtime_error",
}

export enum IssueStatus {
  DETECTED = "detected",
  IN_PROGRESS = "in_progress",
  RESOLVED = "resolved",
  SKIPPED = "skipped",
}

export enum IssueSourceType {
  LOG = "log",
  SCREENSHOT = "screenshot",
  CONSOLE = "console",
  TEST_OUTPUT = "test_output",
  AI_ANALYSIS = "ai_analysis",
  OTHER = "other",
}

export interface IssueSource {
  type: IssueSourceType;
  path?: string;
  line_range?: [number, number];
  description?: string;
}

export interface DetectedIssue {
  id: string;
  session_id: string;
  project_id?: string;
  user_id: string;

  // Issue details
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  description?: string;

  // Location (where the error occurs in code)
  file?: string;
  line?: number;

  // Source (where the AI found the error)
  source: IssueSource;

  // Status tracking
  status: IssueStatus;
  resolution?: string;

  // Timestamps
  detected_at: string;
  resolved_at?: string;
  created_at: string;
  updated_at: string;
}

export interface DetectedIssueCreate {
  session_id: string;
  project_id?: string;
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  description?: string;
  file?: string;
  line?: number;
  source: IssueSource;
  detected_at: string;
}

export interface DetectedIssueUpdate {
  status?: IssueStatus;
  resolution?: string;
}

export interface IssueStats {
  total: number;
  by_status: Record<string, number>;
  by_severity: Record<string, number>;
  by_type: Record<string, number>;
  resolved_today: number;
  detected_today: number;
}

export interface IssueFilters {
  project_id?: string;
  session_id?: string;
  status?: IssueStatus;
  severity?: IssueSeverity;
  type?: IssueType;
}

export interface IssueListResponse {
  issues: DetectedIssue[];
  total: number;
  limit: number;
  offset: number;
}

// Severity display configuration
export const ISSUE_SEVERITY_CONFIG: Record<
  IssueSeverity,
  {
    label: string;
    color: string;
    bgColor: string;
  }
> = {
  [IssueSeverity.CRITICAL]: {
    label: "Critical",
    color: "text-red-700",
    bgColor: "bg-red-100 border-red-300",
  },
  [IssueSeverity.HIGH]: {
    label: "High",
    color: "text-orange-700",
    bgColor: "bg-orange-100 border-orange-300",
  },
  [IssueSeverity.MEDIUM]: {
    label: "Medium",
    color: "text-yellow-700",
    bgColor: "bg-yellow-100 border-yellow-300",
  },
  [IssueSeverity.LOW]: {
    label: "Low",
    color: "text-blue-700",
    bgColor: "bg-blue-100 border-blue-300",
  },
};

// Status display configuration
export const ISSUE_STATUS_CONFIG: Record<
  IssueStatus,
  {
    label: string;
    color: string;
    bgColor: string;
    icon: string;
  }
> = {
  [IssueStatus.DETECTED]: {
    label: "Detected",
    color: "text-red-600",
    bgColor: "bg-red-100 border-red-200",
    icon: "AlertTriangle",
  },
  [IssueStatus.IN_PROGRESS]: {
    label: "In Progress",
    color: "text-yellow-600",
    bgColor: "bg-yellow-100 border-yellow-200",
    icon: "Loader",
  },
  [IssueStatus.RESOLVED]: {
    label: "Resolved",
    color: "text-green-600",
    bgColor: "bg-green-100 border-green-200",
    icon: "CheckCircle",
  },
  [IssueStatus.SKIPPED]: {
    label: "Skipped",
    color: "text-gray-600",
    bgColor: "bg-gray-100 border-gray-200",
    icon: "XCircle",
  },
};

// Type display configuration
export const ISSUE_TYPE_CONFIG: Record<
  IssueType,
  {
    label: string;
    color: string;
  }
> = {
  [IssueType.ERROR]: {
    label: "Error",
    color: "text-red-600",
  },
  [IssueType.WARNING]: {
    label: "Warning",
    color: "text-yellow-600",
  },
  [IssueType.EXCEPTION]: {
    label: "Exception",
    color: "text-orange-600",
  },
  [IssueType.TYPE_ERROR]: {
    label: "Type Error",
    color: "text-purple-600",
  },
  [IssueType.RUNTIME_ERROR]: {
    label: "Runtime Error",
    color: "text-red-700",
  },
};

// Source type display configuration
export const ISSUE_SOURCE_CONFIG: Record<
  IssueSourceType,
  {
    label: string;
    icon: string;
  }
> = {
  [IssueSourceType.LOG]: {
    label: "Log File",
    icon: "FileText",
  },
  [IssueSourceType.SCREENSHOT]: {
    label: "Screenshot",
    icon: "Image",
  },
  [IssueSourceType.CONSOLE]: {
    label: "Console",
    icon: "Terminal",
  },
  [IssueSourceType.TEST_OUTPUT]: {
    label: "Test Output",
    icon: "TestTube",
  },
  [IssueSourceType.AI_ANALYSIS]: {
    label: "AI Analysis",
    icon: "Brain",
  },
  [IssueSourceType.OTHER]: {
    label: "Other",
    icon: "MoreHorizontal",
  },
};
