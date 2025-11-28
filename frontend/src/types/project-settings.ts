/**
 * Project Settings - Action parameters and configuration
 *
 * These settings control default behavior for actions in automation processes.
 * Maps to qontinui library's framework settings and action configuration.
 */

export interface MouseSettings {
  // Click timing
  click_hold_duration: number; // How long to hold button during click (ms)
  click_release_delay: number; // Delay after releasing button (ms)
  click_safety_release: boolean; // Release all buttons before clicking
  double_click_interval: number; // Time between double clicks (ms)

  // Drag timing
  drag_start_delay: number; // Delay before starting drag (ms)
  drag_end_delay: number; // Delay after ending drag (ms)
  drag_default_duration: number; // Default drag animation duration (ms)

  // Move timing
  move_default_duration: number; // Default move animation duration (ms)
  safety_release_delay: number; // Delay after safety release (ms)
}

export interface KeyboardSettings {
  // Key timing
  key_hold_duration: number; // How long to hold key during press (ms)
  key_release_delay: number; // Delay after releasing key (ms)
  typing_interval: number; // Delay between typed characters (ms)
  hotkey_hold_duration: number; // Duration for hotkey holds (ms)
  hotkey_press_interval: number; // Interval between hotkey presses (ms)
}

export interface FindSettings {
  // Image matching
  default_timeout: number; // Find operation timeout (ms)
  default_retry_count: number; // Number of find retries
  search_interval: number; // Delay between search attempts (ms)
}

export interface WaitSettings {
  pause_before_action: number; // Global pause before actions (ms)
  pause_after_action: number; // Global pause after actions (ms)
}

export interface ExecutionSettings {
  default_timeout: number; // Default action timeout (ms)
  default_retry_count: number; // Default retry count for failed actions
  action_delay: number; // Delay between actions (ms)
  failure_strategy: "stop" | "continue" | "pause";
}

export interface RecognitionSettings {
  default_threshold: number; // Default similarity threshold (0.0-1.0)
  multi_scale_search: boolean; // Enable multi-scale search
  color_space: "rgb" | "grayscale" | "hsv";
  edge_detection: boolean; // Enable edge detection
  ocr_enabled: boolean; // Enable OCR
}

export interface ProjectSettings {
  mouse: MouseSettings;
  keyboard: KeyboardSettings;
  find: FindSettings;
  wait: WaitSettings;
  execution: ExecutionSettings;
  recognition: RecognitionSettings;
}

// Default settings that match qontinui framework defaults
export const DEFAULT_MOUSE_SETTINGS: MouseSettings = {
  click_hold_duration: 100,
  click_release_delay: 50,
  click_safety_release: true,
  double_click_interval: 300,
  drag_start_delay: 100,
  drag_end_delay: 100,
  drag_default_duration: 500,
  move_default_duration: 500,
  safety_release_delay: 50,
};

export const DEFAULT_KEYBOARD_SETTINGS: KeyboardSettings = {
  key_hold_duration: 50,
  key_release_delay: 50,
  typing_interval: 50,
  hotkey_hold_duration: 100,
  hotkey_press_interval: 50,
};

export const DEFAULT_FIND_SETTINGS: FindSettings = {
  default_timeout: 30000,
  default_retry_count: 0,
  search_interval: 500,
};

export const DEFAULT_WAIT_SETTINGS: WaitSettings = {
  pause_before_action: 0,
  pause_after_action: 0,
};

export const DEFAULT_EXECUTION_SETTINGS: ExecutionSettings = {
  default_timeout: 10000,
  default_retry_count: 0,
  action_delay: 100,
  failure_strategy: "continue",
};

export const DEFAULT_RECOGNITION_SETTINGS: RecognitionSettings = {
  default_threshold: 0.7,
  multi_scale_search: false,
  color_space: "rgb",
  edge_detection: false,
  ocr_enabled: false,
};

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  mouse: DEFAULT_MOUSE_SETTINGS,
  keyboard: DEFAULT_KEYBOARD_SETTINGS,
  find: DEFAULT_FIND_SETTINGS,
  wait: DEFAULT_WAIT_SETTINGS,
  execution: DEFAULT_EXECUTION_SETTINGS,
  recognition: DEFAULT_RECOGNITION_SETTINGS,
};
