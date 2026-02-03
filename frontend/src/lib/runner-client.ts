/**
 * HTTP client for direct communication with the qontinui-runner
 *
 * The runner exposes an HTTP API at port 9876 for automation control.
 * This client handles fetching monitor information and other runner status.
 */

import type { RunnerMonitor } from "@/lib/schemas/geometry";

// Re-export types for backward compatibility
export type {
  RunnerMonitor,
  Monitor,
  MonitorPosition,
} from "@/lib/schemas/geometry";

// Default runner URL - can be overridden via environment variable
// Use 127.0.0.1 instead of localhost to force IPv4 (runner only listens on IPv4)
const RUNNER_BASE_URL =
  process.env.NEXT_PUBLIC_RUNNER_URL || "http://127.0.0.1:9876";

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
 * Error response from runner
 */
export interface RunnerErrorResponse {
  success: false;
  error: string;
  details?: string;
}

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

class RunnerClient {
  protected baseUrl: string;

  constructor(baseUrl: string = RUNNER_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Load a configuration file into the runner
   * This sends the config path to the Python executor for automation
   */
  async loadConfig(configPath: string): Promise<LoadConfigResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(`${this.baseUrl}/load-config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ config_path: configPath }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to load config: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      return {
        success: data.success ?? true,
        data: data.data,
        error: data.error,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load config",
      };
    }
  }

  /**
   * Fetch monitors from the runner
   * Returns monitor information with position descriptors (left, middle, right, primary)
   */
  async getMonitors(): Promise<MonitorsResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    try {
      const response = await fetch(`${this.baseUrl}/monitors`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to fetch monitors: ${response.status} - ${errorText}`
        );
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Check if the runner is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/status`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        // Short timeout for availability check
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get runner status
   */
  async getStatus(): Promise<RunnerStatusResponse> {
    const response = await fetch(`${this.baseUrl}/status`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch runner status: ${response.status} - ${errorText}`
      );
    }

    return response.json();
  }

  /**
   * Capture a screenshot from the specified monitor
   * The runner handles screenshot capture directly via Python bridge
   */
  async captureScreenshot(
    request: CaptureScreenshotRequest = {}
  ): Promise<CaptureScreenshotResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(`${this.baseUrl}/capture-screenshot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to capture screenshot: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      // Handle nested response format from runner API
      if (data.data) {
        return {
          success: data.success ?? true,
          screenshot_base64: data.data.screenshot_base64,
          width: data.data.width,
          height: data.data.height,
          screenshot_path: data.data.screenshot_path,
          error: data.error,
        };
      }
      return {
        success: data.success ?? true,
        screenshot_base64: data.screenshot_base64,
        width: data.width,
        height: data.height,
        screenshot_path: data.screenshot_path,
        error: data.error,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to capture screenshot",
      };
    }
  }

  /**
   * Start web extraction on the runner
   */
  async startExtraction(
    request: StartExtractionRequest
  ): Promise<ExtractionStartResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(`${this.baseUrl}/extraction/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to start extraction: ${response.status} - ${errorText}`,
        };
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to start extraction",
      };
    }
  }

  /**
   * Stop web extraction on the runner
   */
  async stopExtraction(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/extraction/stop`, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to stop extraction: ${response.status} - ${errorText}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to stop extraction",
      };
    }
  }

  /**
   * Get extraction status from the runner
   */
  async getExtractionStatus(): Promise<ExtractionStatusResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/extraction/status`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to get extraction status: ${response.status} - ${errorText}`,
        };
      }

      return response.json();
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get extraction status",
      };
    }
  }

  /**
   * Get extraction screenshot URL
   *
   * Returns the URL to fetch a screenshot from the runner.
   * The screenshot is stored locally on the runner machine.
   */
  getExtractionScreenshotUrl(
    extractionId: string,
    screenshotId: string
  ): string {
    return `${this.baseUrl}/extraction/${extractionId}/screenshot/${screenshotId}`;
  }

  /**
   * Fetch extraction screenshot as a blob
   */
  async getExtractionScreenshot(
    extractionId: string,
    screenshotId: string
  ): Promise<{ success: boolean; blob?: Blob; error?: string }> {
    try {
      const url = this.getExtractionScreenshotUrl(extractionId, screenshotId);
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { success: false, error: "Screenshot not found" };
        }
        return {
          success: false,
          error: `Failed to fetch screenshot: ${response.status}`,
        };
      }

      const blob = await response.blob();
      return { success: true, blob };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to fetch screenshot",
      };
    }
  }

  // ============================================================================
  // Playwright State Collector Methods
  // ============================================================================

  /**
   * Start Playwright state collection
   */
  async startPlaywrightCollection(
    request: StartPlaywrightCollectionRequest
  ): Promise<PlaywrightCollectionStartResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout

    try {
      const response = await fetch(
        `${this.baseUrl}/playwright-collection/start`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to start Playwright collection: ${response.status} - ${errorText}`,
        };
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to start Playwright collection",
      };
    }
  }

  /**
   * Get Playwright collection status
   */
  async getPlaywrightCollectionStatus(
    jobId?: string
  ): Promise<PlaywrightCollectionStatusResponse> {
    try {
      const params = new URLSearchParams();
      if (jobId) {
        params.set("job_id", jobId);
      }

      const url = `${this.baseUrl}/playwright-collection/status${params.toString() ? `?${params.toString()}` : ""}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to get Playwright collection status: ${response.status} - ${errorText}`,
        };
      }

      return response.json();
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get Playwright collection status",
      };
    }
  }

  /**
   * Get Playwright collection results
   */
  async getPlaywrightCollectionResults(
    jobId?: string
  ): Promise<PlaywrightCollectionResultsResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout for large results

    try {
      const params = new URLSearchParams();
      if (jobId) {
        params.set("job_id", jobId);
      }

      const url = `${this.baseUrl}/playwright-collection/results${params.toString() ? `?${params.toString()}` : ""}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to get Playwright collection results: ${response.status} - ${errorText}`,
        };
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get Playwright collection results",
      };
    }
  }

  /**
   * Stop Playwright collection
   */
  async stopPlaywrightCollection(): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const response = await fetch(
        `${this.baseUrl}/playwright-collection/stop`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to stop Playwright collection: ${response.status} - ${errorText}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to stop Playwright collection",
      };
    }
  }

  // ============================================================================
  // Pattern Matching Methods
  // ============================================================================

  /**
   * Find the best match of a template in a screenshot
   */
  async patternFind(
    request: PatternMatchRequest
  ): Promise<PatternMatchResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(`${this.baseUrl}/pattern/find`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          matches: [],
          search_time_ms: 0,
          screenshot_width: 0,
          screenshot_height: 0,
          template_width: 0,
          template_height: 0,
          error: `Failed to find pattern: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      // Handle nested response format from runner API
      if (data.data) {
        return {
          success: data.success ?? true,
          ...data.data,
          error: data.error,
        };
      }
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        matches: [],
        search_time_ms: 0,
        screenshot_width: 0,
        screenshot_height: 0,
        template_width: 0,
        template_height: 0,
        error: error instanceof Error ? error.message : "Failed to find pattern",
      };
    }
  }

  /**
   * Find all matches of a template in a screenshot
   */
  async patternFindAll(
    request: PatternMatchRequest
  ): Promise<PatternMatchResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout for find_all

    try {
      const response = await fetch(`${this.baseUrl}/pattern/find-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          matches: [],
          search_time_ms: 0,
          screenshot_width: 0,
          screenshot_height: 0,
          template_width: 0,
          template_height: 0,
          error: `Failed to find all patterns: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      // Handle nested response format from runner API
      if (data.data) {
        return {
          success: data.success ?? true,
          ...data.data,
          error: data.error,
        };
      }
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        matches: [],
        search_time_ms: 0,
        screenshot_width: 0,
        screenshot_height: 0,
        template_width: 0,
        template_height: 0,
        error:
          error instanceof Error ? error.message : "Failed to find all patterns",
      };
    }
  }

  // ============================================================================
  // Model Management Methods
  // ============================================================================

  /**
   * List all available models with their download status
   */
  async listModels(): Promise<ModelListResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          models: [],
          error: `Failed to list models: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      if (data.data) {
        return { success: true, models: data.data.models || [], error: data.error };
      }
      return data;
    } catch (error) {
      return {
        success: false,
        models: [],
        error: error instanceof Error ? error.message : "Failed to list models",
      };
    }
  }

  /**
   * Download a model
   * Note: This is a long-running operation that returns when complete
   */
  async downloadModel(modelId: string, force = false): Promise<ModelDownloadResponse> {
    const controller = new AbortController();
    // 10 minute timeout for model downloads
    const timeoutId = setTimeout(() => controller.abort(), 600000);

    try {
      const response = await fetch(`${this.baseUrl}/models/download`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ model_id: modelId, force }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to download model: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      if (data.data) {
        return { success: true, ...data.data, error: data.error };
      }
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to download model",
      };
    }
  }

  /**
   * Delete a downloaded model
   */
  async deleteModel(modelId: string): Promise<{ success: boolean; deleted?: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/models/delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ model_id: modelId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to delete model: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      if (data.data) {
        return { success: true, deleted: data.data.deleted, error: data.error };
      }
      return data;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete model",
      };
    }
  }

  /**
   * Get status of a specific model
   */
  async getModelStatus(modelId: string): Promise<ModelStatusResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/models/${modelId}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          model_id: modelId,
          available: false,
          path: null,
          info: null,
          error: `Failed to get model status: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      if (data.data) {
        return { success: true, ...data.data, error: data.error };
      }
      return data;
    } catch (error) {
      return {
        success: false,
        model_id: modelId,
        available: false,
        path: null,
        info: null,
        error: error instanceof Error ? error.message : "Failed to get model status",
      };
    }
  }

  /**
   * Get disk usage for all downloaded models
   */
  async getModelsDiskUsage(): Promise<ModelDiskUsageResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/models/disk-usage`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          total_bytes: 0,
          models: {},
          models_dir: "",
          error: `Failed to get disk usage: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      if (data.data) {
        return { success: true, ...data.data, error: data.error };
      }
      return data;
    } catch (error) {
      return {
        success: false,
        total_bytes: 0,
        models: {},
        models_dir: "",
        error: error instanceof Error ? error.message : "Failed to get disk usage",
      };
    }
  }

  // ============================================================================
  // Integration Testing Methods
  // ============================================================================

  /**
   * Start an integration test run
   */
  async startIntegrationTest(
    request: StartIntegrationTestRequest
  ): Promise<{ success: boolean; run_id?: string; error?: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${this.baseUrl}/testing/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to start test: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      return {
        success: data.success ?? true,
        run_id: data.data?.run_id,
        error: data.error,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to start integration test",
      };
    }
  }

  /**
   * Get test run status
   */
  async getTestRunStatus(
    runId: string
  ): Promise<{
    success: boolean;
    status?: TestRunStatus;
    progress?: { total: number; passed: number; failed: number; pending: number };
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/testing/status/${runId}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, error: `Failed to get status: ${response.status}` };
      }

      const data = await response.json();
      return {
        success: true,
        status: data.data?.status,
        progress: data.data?.progress,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get test status",
      };
    }
  }

  /**
   * Get test results
   */
  async getTestResults(
    runId: string
  ): Promise<{ success: boolean; results?: TestResult[]; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/testing/results/${runId}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        return { success: false, error: `Failed to get results: ${response.status}` };
      }

      const data = await response.json();
      return {
        success: true,
        results: data.data?.results,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get test results",
      };
    }
  }

  /**
   * List test runs
   */
  async listTestRuns(
    limit = 50
  ): Promise<{ success: boolean; runs?: TestRunSummary[]; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/testing/runs?limit=${limit}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, error: `Failed to list runs: ${response.status}` };
      }

      const data = await response.json();
      return {
        success: true,
        runs: data.data?.runs,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list test runs",
      };
    }
  }

  /**
   * End test run
   */
  async endTestRun(
    runId: string
  ): Promise<{ success: boolean; run?: TestRunResult; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/testing/end/${runId}`, {
        method: "POST",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        return { success: false, error: `Failed to end test: ${response.status}` };
      }

      const data = await response.json();
      return {
        success: true,
        run: data.data?.run,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to end test run",
      };
    }
  }

  /**
   * Get testing states
   */
  async getTestingStates(): Promise<{
    success: boolean;
    states?: TestingState[];
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/testing/states`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, error: `Failed to get states: ${response.status}` };
      }

      const data = await response.json();
      return {
        success: true,
        states: data.data?.states,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get states",
      };
    }
  }

  /**
   * Get testing transitions
   */
  async getTestingTransitions(): Promise<{
    success: boolean;
    transitions?: TestingTransition[];
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/testing/transitions`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, error: `Failed to get transitions: ${response.status}` };
      }

      const data = await response.json();
      return {
        success: true,
        transitions: data.data?.transitions,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get transitions",
      };
    }
  }

  /**
   * Find path between states
   */
  async findPath(
    fromState: string,
    toState: string
  ): Promise<{ success: boolean; path?: unknown; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/testing/find-path`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ from_state: fromState, to_state: toState }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        return { success: false, error: `Failed to find path: ${response.status}` };
      }

      const data = await response.json();
      return {
        success: data.data?.success ?? true,
        path: data.data?.path,
        error: data.data?.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to find path",
      };
    }
  }

  /**
   * Traverse to state
   */
  async traverseToState(
    targetState: string,
    execute = true
  ): Promise<{ success: boolean; active_states?: string[]; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/testing/traverse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ target_state: targetState, execute }),
        signal: AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        return { success: false, error: `Failed to traverse: ${response.status}` };
      }

      const data = await response.json();
      return {
        success: data.data?.success ?? true,
        active_states: data.data?.active_states,
        error: data.data?.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to traverse to state",
      };
    }
  }

  /**
   * Get active states
   */
  async getActiveStates(): Promise<{
    success: boolean;
    active_states?: string[];
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/testing/active-states`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, error: `Failed to get active states: ${response.status}` };
      }

      const data = await response.json();
      return {
        success: true,
        active_states: data.data?.active_states,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get active states",
      };
    }
  }

  /**
   * Set mock mode
   */
  async setMockMode(mode: MockMode): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/testing/mock-mode`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ mode }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, error: `Failed to set mock mode: ${response.status}` };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to set mock mode",
      };
    }
  }

  /**
   * Mock an action
   */
  async mockAction(
    actionType: string,
    params: Record<string, unknown>
  ): Promise<{ success: boolean; action_id?: string; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/testing/mock-action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ action_type: actionType, ...params }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, error: `Failed to mock action: ${response.status}` };
      }

      const data = await response.json();
      return {
        success: true,
        action_id: data.data?.action_id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to mock action",
      };
    }
  }

  /**
   * Get mocked actions
   */
  async getMockedActions(): Promise<{
    success: boolean;
    actions?: MockedAction[];
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/testing/mocked-actions`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, error: `Failed to get mocked actions: ${response.status}` };
      }

      const data = await response.json();
      return {
        success: true,
        actions: data.data?.actions,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get mocked actions",
      };
    }
  }

  /**
   * Clear mocked actions
   */
  async clearMockedActions(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/testing/clear-mocked-actions`, {
        method: "POST",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, error: `Failed to clear mocked actions: ${response.status}` };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to clear mocked actions",
      };
    }
  }

  /**
   * Run an assertion
   */
  async runAssertion(
    assertionType: string,
    target: string,
    expected?: unknown,
    timeoutSeconds = 30
  ): Promise<{ success: boolean; assertion?: AssertionResult; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/testing/assertion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          assertion_type: assertionType,
          target,
          expected,
          timeout_seconds: timeoutSeconds,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        return { success: false, error: `Failed to run assertion: ${response.status}` };
      }

      const data = await response.json();
      return {
        success: true,
        assertion: data.data?.assertion,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to run assertion",
      };
    }
  }

  // ============================================================================
  // Workflow Execution Methods
  // ============================================================================

  /**
   * Run a workflow by name
   * Requires a config to be loaded first via loadConfig()
   */
  async runWorkflow(
    workflowName: string,
    options: { monitorIndex?: number; timeoutSeconds?: number } = {}
  ): Promise<RunWorkflowResponse> {
    const controller = new AbortController();
    const timeoutMs = (options.timeoutSeconds ?? 300) * 1000 + 30000; // Add 30s buffer
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/run-workflow`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          workflow_name: workflowName,
          monitor_index: options.monitorIndex,
          timeout_seconds: options.timeoutSeconds ?? 300,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          workflow_name: workflowName,
          error: `Failed to run workflow: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      // Handle nested response format from runner API
      if (data.data) {
        return {
          success: data.data.success ?? data.success ?? true,
          workflow_name: workflowName,
          execution_time_ms: data.data.execution_time_ms,
          states_visited: data.data.states_visited,
          error: data.data.error ?? data.error,
        };
      }
      return {
        success: data.success ?? true,
        workflow_name: workflowName,
        execution_time_ms: data.execution_time_ms,
        states_visited: data.states_visited,
        error: data.error,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        workflow_name: workflowName,
        error: error instanceof Error ? error.message : "Failed to run workflow",
      };
    }
  }

  /**
   * Stop the current workflow execution
   */
  async stopWorkflow(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/stop-execution`, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to stop workflow: ${response.status} - ${errorText}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to stop workflow",
      };
    }
  }

  // ==========================================================================
  // Click Capture (Template Capture) Methods
  // ==========================================================================

  async startClickCapture(
    sessionId: string,
    applicationName?: string
  ): Promise<ClickCaptureStartResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${this.baseUrl}/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          type: "start_click_capture",
          params: {
            session_id: sessionId,
            application_name: applicationName,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to start click capture: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      return {
        success: data.success ?? true,
        session_id: data.data?.session_id ?? sessionId,
        error: data.error,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to start click capture",
      };
    }
  }

  async stopClickCapture(): Promise<ClickCaptureStopResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min for processing

    try {
      const response = await fetch(`${this.baseUrl}/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          type: "stop_click_capture",
          params: {},
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Failed to stop click capture: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      return {
        success: data.success ?? true,
        candidates_count: data.data?.candidates_count,
        session_id: data.data?.session_id,
        error: data.error,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to stop click capture",
      };
    }
  }

  async getClickCaptureStatus(): Promise<ClickCaptureStatusResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          type: "get_click_capture_status",
          params: {},
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to get click capture status: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: data.success ?? true,
        is_active: data.data?.is_active,
        session_id: data.data?.session_id,
        start_time: data.data?.start_time,
        application_name: data.data?.application_name,
        error: data.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get click capture status",
      };
    }
  }

  /**
   * Send a generic command to the runner
   */
  async sendCommand<T = unknown>(
    type: string,
    params: Record<string, unknown> = {},
    timeoutMs = 120000
  ): Promise<{ success: boolean; result?: T; error?: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ type, params }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Command failed: ${response.status} - ${errorText}`,
        };
      }

      const data = await response.json();
      return {
        success: data.success ?? true,
        result: data.data as T,
        error: data.error,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Command failed",
      };
    }
  }
}

// ============================================================================
// Workflow Execution Types
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

export const runnerClient = new RunnerClient();
