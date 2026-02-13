// =============================================================================
// Log Source Types
// =============================================================================

export interface LogSource {
  id: number;
  name: string;
  path: string;
  enabled: boolean;
  log_type: string;
}

// Global Log Source types (matching Rust backend GlobalLogSource*)
export type LogSourceCategory =
  | "frontend"
  | "backend"
  | "api"
  | "mobile"
  | "database"
  | "build"
  | "testing"
  | "runner"
  | "general";

export type LogSourceAiSelectionMode = "dynamic" | "static" | "disabled";

export interface GlobalLogSource {
  id: string;
  name: string;
  description: string;
  category: LogSourceCategory;
  type: string; // "file" or "directory"
  path: string;
  pattern?: string;
  tail_lines: number;
  enabled: boolean;
  color?: string;
  keywords: string[];
  format: string;
  parser: string;
  timestamp_pattern?: string;
  timezone: string;
  error_patterns: string[];
  warning_patterns: string[];
  ignore_patterns: string[];
  poll_interval_ms: number;
}

export interface GlobalLogSourceProfile {
  id: string;
  name: string;
  description?: string;
  source_ids: string[];
  created_at?: string;
  updated_at?: string;
}

export interface GlobalLogSourceSettings {
  sources: GlobalLogSource[];
  profiles: GlobalLogSourceProfile[];
  default_profile_id?: string;
  ai_selection_mode: LogSourceAiSelectionMode;
  include_all_when_no_profile: boolean;
}
