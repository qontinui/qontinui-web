/**
 * HTTP client for direct communication with the qontinui-runner
 *
 * The runner exposes an HTTP API at port 9876 for automation control.
 * This client handles fetching monitor information and other runner status.
 */

// Default runner URL - can be overridden via environment variable
const RUNNER_BASE_URL =
  process.env.NEXT_PUBLIC_RUNNER_URL || "http://localhost:9876";

/**
 * Monitor information from the runner
 */
export interface RunnerMonitor {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  is_primary: boolean;
  position: "left" | "middle" | "right" | "primary";
  name: string;
  description: string;
}

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

class RunnerClient {
  private baseUrl: string;

  constructor(baseUrl: string = RUNNER_BASE_URL) {
    this.baseUrl = baseUrl;
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
        throw new Error(`Failed to fetch monitors: ${response.status} - ${errorText}`);
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
      throw new Error(`Failed to fetch runner status: ${response.status} - ${errorText}`);
    }

    return response.json();
  }
}

export const runnerClient = new RunnerClient();
