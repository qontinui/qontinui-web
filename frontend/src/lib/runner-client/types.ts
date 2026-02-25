/**
 * All interfaces and types for the runner client.
 *
 * Centralized type definitions used across all sub-clients.
 */

import type { RunnerMonitor } from "@/lib/schemas/geometry";

// Re-export geometry types for convenience
export type {
  RunnerMonitor,
  Monitor,
  MonitorPosition,
} from "@/lib/schemas/geometry";

// ============================================================================
// Base / Error Types
// ============================================================================

/**
 * Error response from runner
 */
export interface RunnerErrorResponse {
  success: false;
  error: string;
  details?: string;
}

// ============================================================================
// Config / Status Types
// ============================================================================

/**
 * Response from GET /monitors endpoint
 */
export interface MonitorsResponse {
  success: boolean;
  message?: string;
  data: {
    count: number;
    monitors: RunnerMonitor[];
    available_descriptors: string[];
  };
}

/**
 * Response from GET /status endpoint
 */
export interface RunnerStatusResponse {
  success: boolean;
  data: {
    status: "idle" | "executing" | "paused";
    config_loaded: boolean;
    current_workflow?: string;
    executor_version?: string;
    python_version?: string;
  };
}

/**
 * Response from POST /load-config endpoint
 */
export interface LoadConfigResponse {
  success: boolean;
  data?: string;
  error?: string;
}

/**
 * Request for POST /capture-screenshot endpoint
 */
export interface CaptureScreenshotRequest {
  monitor?: number;
  delay_seconds?: number;
  task_id?: string;
  step_index?: number;
}

/**
 * Response from POST /capture-screenshot endpoint
 */
export interface CaptureScreenshotResponse {
  success: boolean;
  screenshot_base64?: string;
  width?: number;
  height?: number;
  screenshot_path?: string;
  error?: string;
}

// ============================================================================
// Extraction Types
// ============================================================================

/**
 * Request to start web extraction
 */
export interface StartExtractionRequest {
  urls: string[];
  viewports: [number, number][];
  capture_hover_states: boolean;
  capture_focus_states: boolean;
  max_depth: number;
  max_pages: number;
  session_id?: string;
  backend_url?: string;
  auth_token?: string; // Auth token for backend API calls
}

/**
 * Response from extraction start
 */
export interface ExtractionStartResponse {
  success: boolean;
  data?: {
    extraction_id?: string;
    success?: boolean;
    error?: string;
  };
  error?: string;
}

/**
 * Response from extraction status
 */
export interface ExtractionStatusResponse {
  success: boolean;
  data?: {
    is_running: boolean;
    extraction_id?: string;
    stats?: {
      states_found: number;
      transitions_found: number;
      pages_extracted: number;
      errors: number;
    };
  };
  error?: string;
}

// ============================================================================
// Playwright Types
// ============================================================================

/**
 * Request to start Playwright state collection
 */
export interface StartPlaywrightCollectionRequest {
  url: string;
  max_depth?: number;
  max_elements_per_page?: number;
  max_risk_level?: "safe" | "caution" | "dry_run";
  dry_run?: boolean;
  verify_extractions?: boolean;
  verification_threshold?: number;
  additional_blocked_keywords?: string[];
  additional_safe_keywords?: string[];
  blocked_selectors?: string[];
}

/**
 * Response from Playwright collection start
 */
export interface PlaywrightCollectionStartResponse {
  success: boolean;
  data?: {
    job_id?: string;
    success?: boolean;
    error?: string;
  };
  error?: string;
}

/**
 * Response from Playwright collection status
 */
export interface PlaywrightCollectionStatusResponse {
  success: boolean;
  data?: {
    job_id?: string;
    status: "idle" | "pending" | "running" | "completed" | "failed";
    url?: string;
    progress_message?: string;
    progress_percent?: number;
    error?: string;
    has_results?: boolean;
  };
  error?: string;
}

/**
 * Extracted clickable element from Playwright collection
 */
export interface PlaywrightClickable {
  element_id: string;
  selector: string;
  tag_name: string;
  text?: string;
  aria_label?: string;
  bounding_box: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  risk_level?: string;
  risk_reason?: string;
  was_clicked?: boolean;
  verification_confidence?: number;
  verified?: boolean;
  error?: string;
  screenshot?: string; // base64
  page_screenshot_before?: string; // base64
  page_screenshot_after?: string; // base64
}

/**
 * Response from Playwright collection results
 */
export interface PlaywrightCollectionResultsResponse {
  success: boolean;
  data?: {
    success: boolean;
    job_id?: string;
    url?: string;
    clickables?: PlaywrightClickable[];
    skipped_dangerous?: Array<{
      selector: string;
      text?: string;
      risk: string;
      reason: string;
      url: string;
    }>;
    metrics?: {
      total_found: number;
      clicked: number;
      skipped_dangerous: number;
      pages_visited: number;
      errors: number;
      verified?: number;
      unverified?: number;
    };
    pages_visited?: string[];
    errors?: string[];
    error?: string;
  };
  error?: string;
}

// ============================================================================
// Pattern Matching Types
// ============================================================================

/**
 * Search region for pattern matching
 */
export interface PatternSearchRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Request for pattern matching operations
 */
export interface PatternMatchRequest {
  /** Base64 encoded screenshot or file path */
  screenshot: string;
  /** Base64 encoded template image or file path */
  template: string;
  /** Minimum similarity threshold (0.0 to 1.0), default 0.8 */
  similarity?: number;
  /** Optional region to search within */
  search_region?: PatternSearchRegion;
  /** Maximum number of matches to return (for find_all), default 100 */
  max_matches?: number;
}

/**
 * A single pattern match result
 */
export interface PatternMatch {
  x: number;
  y: number;
  width: number;
  height: number;
  similarity: number;
  center_x: number;
  center_y: number;
}

/**
 * Response from pattern matching operations
 */
export interface PatternMatchResponse {
  success: boolean;
  matches: PatternMatch[];
  search_time_ms: number;
  screenshot_width: number;
  screenshot_height: number;
  template_width: number;
  template_height: number;
  error?: string;
}

// ============================================================================
// Model Management Types
// ============================================================================

/**
 * Available model types
 */
export type ModelType = "sam3" | "sam3_large" | "clip" | "easyocr";

/**
 * Information about a model
 */
export interface ModelInfo {
  id: string;
  name: string;
  type: string;
  description: string;
  size_bytes: number;
  available: boolean;
}

/**
 * Model status response
 */
export interface ModelStatusResponse {
  success: boolean;
  model_id: string;
  available: boolean;
  path: string | null;
  info: {
    name: string;
    type: string;
    description: string;
    size_bytes: number;
  } | null;
  error?: string;
}

/**
 * Model disk usage response
 */
export interface ModelDiskUsageResponse {
  success: boolean;
  total_bytes: number;
  models: Record<string, number>;
  models_dir: string;
  error?: string;
}

/**
 * Model download request
 */
export interface ModelDownloadRequest {
  model_id: string;
  force?: boolean;
}

/**
 * Model download response
 */
export interface ModelDownloadResponse {
  success: boolean;
  path?: string;
  model_id?: string;
  error?: string;
}

/**
 * Model list response
 */
export interface ModelListResponse {
  success: boolean;
  models: ModelInfo[];
  error?: string;
}

// ============================================================================
// Integration Testing Types
// ============================================================================

/**
 * Request to start an integration test run
 */
export interface StartIntegrationTestRequest {
  name: string;
  config_path?: string;
  test_cases?: IntegrationTestCase[];
  metadata?: Record<string, unknown>;
}

/**
 * A test case for integration testing
 */
export interface IntegrationTestCase {
  test_id?: string;
  name: string;
  description?: string;
  assertions: IntegrationTestAssertion[];
  setup_actions?: Record<string, unknown>[];
  teardown_actions?: Record<string, unknown>[];
}

/**
 * An assertion for integration testing
 */
export interface IntegrationTestAssertion {
  type: string;
  target: string;
  expected?: unknown;
  timeout_seconds?: number;
}

/**
 * Test run status
 */
export type TestRunStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "error";

/**
 * Test run summary
 */
export interface TestRunSummary {
  run_id: string;
  name: string;
  status: TestRunStatus;
  start_time?: string;
  end_time?: string;
  test_count: number;
  passed: number;
  failed: number;
}

/**
 * Test run result
 */
export interface TestRunResult {
  run_id: string;
  name: string;
  status: TestRunStatus;
  start_time?: string;
  end_time?: string;
  config_path?: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    pass_rate: number;
  };
  test_results: TestResult[];
  metadata?: Record<string, unknown>;
}

/**
 * Individual test result
 */
export interface TestResult {
  test_id: string;
  test_name: string;
  status: TestRunStatus;
  assertions: AssertionResult[];
  start_time?: string;
  end_time?: string;
  duration_ms?: number;
  error_message?: string;
  mocked_actions_count?: number;
}

/**
 * Assertion result
 */
export interface AssertionResult {
  assertion_id: string;
  type: string;
  target: string;
  expected?: unknown;
  passed: boolean;
  error_message?: string;
  actual_value?: string;
}

/**
 * State info from testing API
 */
export interface TestingState {
  id: string | number;
  name: string;
  is_initial?: boolean;
  is_terminal?: boolean;
  state_images_count?: number;
  transitions_count?: number;
}

/**
 * Transition info from testing API
 */
export interface TestingTransition {
  id?: string;
  source_state_id: string | number;
  source_state_name?: string;
  target_state_ids: (string | number)[];
  workflow_id?: string;
  name?: string;
}

/**
 * Mock mode for GUI actions
 */
export type MockMode = "disabled" | "record" | "playback";

/**
 * Mocked action record
 */
export interface MockedAction {
  action_id: string;
  action_type: string;
  target?: string;
  config: Record<string, unknown>;
  timestamp: string;
  executed: boolean;
}

// ============================================================================
// Workflow Types
// ============================================================================

/**
 * Response from workflow execution
 */
export interface RunWorkflowResponse {
  success: boolean;
  workflow_name: string;
  execution_time_ms?: number;
  states_visited?: string[];
  error?: string;
}

// ============================================================================
// Click Capture Types
// ============================================================================

/**
 * Response from click capture start
 */
export interface ClickCaptureStartResponse {
  success: boolean;
  session_id?: string;
  error?: string;
}

/**
 * Response from click capture stop
 */
export interface ClickCaptureStopResponse {
  success: boolean;
  candidates_count?: number;
  session_id?: string;
  error?: string;
}

/**
 * Response from click capture status
 */
export interface ClickCaptureStatusResponse {
  success: boolean;
  is_active?: boolean;
  session_id?: string;
  start_time?: number;
  application_name?: string;
  click_count?: number;
  error?: string;
}
