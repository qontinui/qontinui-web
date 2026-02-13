// =============================================================================
// Settings Types
// =============================================================================

export interface GeneralSettings {
  auto_load_last_config: boolean;
  include_summary_step_by_default: boolean;
  preflight_check_enabled: boolean;
  session_auto_fix_on_failure: boolean;
}

export interface AiSettings {
  provider: "claude_cli" | "claude_api" | "gemini_cli" | "gemini_api";
  claude_cli: {
    execution_mode: string;
    custom_path: string | null;
    timeout_seconds: number;
    config_dir: string | null;
  };
  claude_api: {
    model: string;
    max_tokens: number;
  };
  gemini_cli: {
    execution_mode: string;
    custom_path: string | null;
    timeout_seconds: number;
    auth_method: "oauth" | "api_key";
    model: string;
  };
  gemini_api: {
    model: string;
    max_output_tokens: number;
    temperature: number;
  };
  auto_refine_video_after_iterations: number;
  interactive_sessions_enabled: boolean;
}

export interface AgenticSettings {
  compression: {
    enabled: boolean;
    threshold_tokens: number;
    target_tokens: number;
    keep_recent_items: number;
    summarize_batch_size: number;
  };
  retry: {
    enabled: boolean;
    max_retries: number;
    base_delay_ms: number;
    max_delay_ms: number;
    exponential_base: number;
    jitter: boolean;
    feedback_injection: boolean;
  };
  routing: {
    enabled: boolean;
    simple_model: string;
    medium_model: string;
    complex_model: string;
    file_threshold_simple: number;
    file_threshold_medium: number;
  };
}

export interface DebugSettings {
  enable_image_debug: boolean;
  top_matches_count: number;
}

export interface PlaywrightSettings {
  test_username: string | null;
  test_password: string | null;
  base_url: string | null;
  skip_web_server: boolean;
}

export interface SelfHealingSettings {
  action_caching_enabled: boolean;
  cache_ttl_seconds: number;
  visual_validation_enabled: boolean;
  llm_mode: "disabled" | "local_ollama" | "remote_api";
  ollama_model: string;
  api_provider: "open_ai" | "anthropic";
}

export interface MobileSettings {
  adb_path: string | null;
  default_device_id: string | null;
  app_package: string | null;
  logcat_lines: number;
  filter_react_native: boolean;
  output_dir: string | null;
}

export interface StorageInfo {
  screenshot_path: string;
  video_path: string;
  screenshot_usage_mb: number;
  screenshot_max_mb: number;
  screenshot_file_count: number;
  video_usage_mb: number;
  video_max_mb: number;
  video_file_count: number;
}

export interface DeviceInfo {
  device_id: string;
  device_name: string;
  platform: string;
}

export interface BackupSummary {
  flows: number;
  flow_executions: number;
  checkpoints: number;
  learning_outcomes: number;
  learning_patterns: number;
  settings: number;
  prompts: number;
  unified_workflows: number;
  verification_tests: number;
  task_hooks: number;
  scheduled_tasks: number;
  saved_api_requests: number;
  configs: number;
}

export interface McpServer {
  id: string;
  name: string;
  description: string | null;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  cwd: string | null;
  url: string | null;
  headers: Record<string, string>;
  timeout_seconds: number;
  enabled: boolean;
  auto_start: boolean;
}

export interface McpServerStatus {
  server_id: string;
  connected: boolean;
  error: string | null;
  tools: McpTool[];
}

export interface McpTool {
  name: string;
  description: string | null;
}

export interface AiConnectionTestResult {
  success: boolean;
  message: string;
  provider: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  description?: string;
  transport: "stdio" | "http";
  enabled: boolean;
  auto_start: boolean;
  cached_tools?: string;
  created_at: string;
  updated_at: string;
}
