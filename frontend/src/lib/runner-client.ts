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
const RUNNER_BASE_URL =
  process.env.NEXT_PUBLIC_RUNNER_URL || "http://localhost:9876";

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

class RunnerClient {
  private baseUrl: string;

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
   * Uses the runner's /capture-screenshot endpoint which internally calls qontinui-api
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
}

export const runnerClient = new RunnerClient();
