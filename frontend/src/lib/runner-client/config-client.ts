/**
 * Config, status, and screenshot operations for the runner client.
 *
 * Handles loadConfig, getMonitors, getAvailability/isAvailable, getStatus, and
 * captureScreenshot.
 */

import {
  describeRunnerOriginRefusal,
  parseRunnerOriginRefusalText,
} from "@/lib/runner/origin-refusal";
import {
  isRunnerNeedsLocalError,
  runnerRequest,
  type RunnerApiError,
} from "@/lib/runner/api-client";
import { BaseClient } from "./base-client";
import type {
  MonitorsResponse,
  RunnerStatusResponse,
  LoadConfigResponse,
  CaptureScreenshotRequest,
  CaptureScreenshotResponse,
} from "./types";

export interface RunnerAvailability {
  available: boolean;
  /**
   * Set only when the runner answered but refused this page's origin, or
   * refused the route over the relay (it needs the runner on this machine) —
   * the runner IS running, so callers must show this instead of "not
   * connected".
   */
  refusalMessage: string | null;
  /**
   * The refusal, when it was the relay refusing the route
   * (RUNNER_NEEDS_LOCAL) — kept typed so a poller can stop on it.
   */
  needsLocalError?: RunnerApiError;
}

export class ConfigClient {
  private base: BaseClient;

  constructor(base: BaseClient) {
    this.base = base;
  }

  /**
   * Load a configuration file into the runner
   * This sends the config path to the Python executor for automation
   */
  async loadConfig(configPath: string): Promise<LoadConfigResponse> {
    try {
      const response = await runnerRequest(this.base.target, "/load-config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ config_path: configPath }),
        timeoutMs: 30000,
      });

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to load config"
        );
        return {
          success: false,
          error: message,
        };
      }

      const data = await response.json();
      return {
        success: data.success ?? true,
        data: data.data,
        error: data.error,
      };
    } catch (error) {
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
    try {
      const response = await runnerRequest(this.base.target, "/monitors", {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        timeoutMs: 5000,
      });

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to fetch monitors"
        );
        throw new Error(message);
      }

      return response.json();
    } catch (error) {
      throw error;
    }
  }

  /**
   * Check whether the runner is reachable AND answers this page.
   *
   * A runner that refuses this page's origin (the typed `CROSS_ORIGIN_REFUSED`
   * 403, plan `2026-09-17-runner-loopback-api-accepts-any-origin`) is running
   * — reporting it as "not connected" would send the operator to start a
   * runner that is already up. So that case comes back with `refusalMessage`
   * set, naming the route, the origin and how to admit it.
   *
   * The 2 s budget is passed as `timeoutMs` — the one deadline concept — so
   * over loopback it bounds the wait for headers, and over the relay it is
   * raised to the relay floor (`RELAY_FLOOR_WAIT_MS`) and sent to the backend
   * as `X-Qontinui-Timeout-Ms`: a healthy relayed runner is never reported
   * unavailable for missing a same-machine budget.
   */
  async getAvailability(): Promise<RunnerAvailability> {
    try {
      const response = await runnerRequest(this.base.target, "/status", {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        // A short, loopback-sized budget; the relay floor makes it relay-aware.
        timeoutMs: 2000,
      });
      if (response.ok) return { available: true, refusalMessage: null };
      if (response.status === 403) {
        const refusal = parseRunnerOriginRefusalText(await response.text());
        if (refusal) {
          return {
            available: false,
            refusalMessage: describeRunnerOriginRefusal(refusal),
          };
        }
      }
      return { available: false, refusalMessage: null };
    } catch (error) {
      // The runner answered but will not carry this route over the relay:
      // it is running, so say what is needed instead of "not connected".
      if (isRunnerNeedsLocalError(error)) {
        return {
          available: false,
          refusalMessage: (error as Error).message,
          needsLocalError: error as RunnerApiError,
        };
      }
      return { available: false, refusalMessage: null };
    }
  }

  /**
   * Check if the runner is available. Use {@link getAvailability} where the
   * caller renders a message: this boolean cannot say WHY it is false.
   */
  async isAvailable(): Promise<boolean> {
    const availability = await this.getAvailability();
    // A relay refusal is not "unavailable": rethrow it typed so a poller
    // stops on it and a caller can say it needs the runner on this machine.
    if (availability.needsLocalError) throw availability.needsLocalError;
    return availability.available;
  }

  /**
   * Get runner status
   */
  async getStatus(): Promise<RunnerStatusResponse> {
    const response = await runnerRequest(this.base.target, "/status", {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const message = await this.base.failureMessage(
        response,
        "Failed to fetch runner status"
      );
      throw new Error(message);
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
    try {
      const response = await runnerRequest(
        this.base.target,
        "/capture-screenshot",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(request),
          timeoutMs: 30000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to capture screenshot"
        );
        return {
          success: false,
          error: message,
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
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to capture screenshot",
      };
    }
  }
}
