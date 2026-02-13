// =============================================================================
// Library Types
// =============================================================================

export interface LibraryItem {
  id: string;
  name: string;
  type: string;
  description?: string;
  updated_at?: string;
  created_at?: string;
}

export interface SavedApiRequest {
  id: string;
  name: string;
  description?: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  body_content_type?: string;
  category?: string;
  tags?: string[];
  timeout_ms?: number;
  follow_redirects?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface PlaywrightScript {
  id: string;
  name: string;
  description?: string;
  script_content: string;
  target_url?: string;
  ai_instructions?: string;
  category?: string;
  tags?: string[];
  timeout_seconds?: number;
  display_mode?: string;
  browser?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SavedPrompt {
  id: string;
  name: string;
  description?: string;
  content: string;
  category?: string;
  tags?: string[];
  max_sessions?: number | null;
  provider?: string;
  model?: string;
  requires_orchestrator?: boolean;
  orchestrator_goal?: string;
  orchestrator_max_iterations?: number;
  created_at?: string;
  updated_at?: string;
}

export interface Scriptlet {
  id: string;
  name: string;
  content: string;
  category?: string;
  tags?: string[];
  source_log_ids?: string[];
  created_at?: string;
  modified_at?: string;
}

export interface Check {
  id: string;
  name: string;
  description?: string;
  check_type: string;
  tool?: string;
  command?: string;
  working_directory?: string;
  config_path?: string;
  auto_fix?: boolean;
  fail_on_warning?: boolean;
  is_critical?: boolean;
  timeout_seconds?: number;
  enabled?: boolean;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface CheckGroup {
  id: string;
  name: string;
  description?: string;
  stop_on_failure?: boolean;
  run_in_parallel?: boolean;
  check_ids?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface Macro {
  id: string;
  name: string;
  description?: string;
  steps: MacroStep[];
  category?: string;
  tags?: string[];
  run_count?: number;
  created_at?: string;
  modified_at?: string;
}

export interface MacroStep {
  id: string;
  action_type: string;
  name?: string;
  target_image_ids?: string[];
  target_image_names?: string[];
  text_input?: string;
  hotkey?: string;
  target_state_ids?: string[];
  target_state_names?: string[];
  pause_after_ms?: number;
  monitor_index?: number;
  timeout_seconds?: number;
}
