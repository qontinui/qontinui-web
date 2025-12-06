/**
 * TypeScript types for automation sessions, screenshots, and logs
 */

export interface AutomationSession {
  id: string;
  project_id: string;
  user_id: string;
  runner_version?: string;
  runner_os?: string;
  runner_hostname?: string;
  status: "active" | "completed" | "failed" | "disconnected";
  started_at: string;
  ended_at?: string;
  last_heartbeat_at: string;
  configuration_snapshot?: Record<string, any>;
  total_screenshots: number;
  total_actions: number;
  error_message?: string;
  created_at: string;
  updated_at?: string;
}

export interface AutomationSessionWithStats extends AutomationSession {
  screenshot_count: number;
  log_count: number;
}

export interface Screenshot {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  s3_key: string;
  presigned_url?: string;
  url_expires_at?: string;
  width: number;
  height: number;
  file_size: number;
  content_type: string;
  project_id: string;
  user_id: string;
  session_id?: string;
  captured_at: string;
  source: "manual" | "runner" | "api";
  automation_metadata?: AutomationMetadata;
  created_at: string;
  updated_at: string;
}

export interface AutomationMetadata {
  state_name?: string;
  action_type?: "click" | "type" | "drag" | "wait" | "capture";
  mouse_position?: { x: number; y: number };
  click_location?: { x: number; y: number };
  drag_locations?: Array<{ x: number; y: number }>;
  keyboard_events?: Array<{ key: string; timestamp: string }>;
  detected_elements?: Array<{
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  recognition_results?: Array<{
    pattern_id: string;
    confidence: number;
    location: { x: number; y: number };
  }>;
  error?: string;
  execution_time_ms?: number;
}

export interface AutomationLog {
  id: string;
  session_id: string;
  timestamp: string;
  level: "debug" | "info" | "warning" | "error" | "critical";
  message: string;
  log_data?: Record<string, any>;
  screenshot_id?: string;
  sequence_number: number;
  created_at: string;
}

export interface ScreenshotList {
  items: Screenshot[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface AutomationLogList {
  items: AutomationLog[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ScreenshotStats {
  total_count: number;
  by_source: {
    manual: number;
    runner: number;
    api: number;
  };
  total_storage_bytes: number;
  total_storage_mb: number;
}

export interface SessionStats {
  total_count: number;
  by_status: {
    active: number;
    completed: number;
    failed: number;
  };
  avg_screenshots_per_session: number;
  total_actions: number;
}
