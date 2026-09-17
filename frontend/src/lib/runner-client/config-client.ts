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
   * Set only when the runner answered but refused this page's origin — the
   * runner IS running, so callers must show this instead of "not connected".
   */
  refusalMessage: string | null;
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(`${this.base.baseUrl}/load-config`, {
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
      const response = await fetch(`${this.base.baseUrl}/monitors`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to fetch monitors"
        );
        throw new Error(message);
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
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
   * set, naming the route, the origin and how to admit it. The whole check,
   * the 403 body read included, stays under the 2s abort.
   */
  async getAvailability(): Promise<RunnerAvailability> {
    try {
      const response = await fetch(`${this.base.baseUrl}/status`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        // Short timeout for availability check
        signal: AbortSignal.timeout(2000),
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
    } catch {
      return { available: false, refusalMessage: null };
    }
  }

  /**
   * Check if the runner is available. Use {@link getAvailability} where the
   * caller renders a message: this boolean cannot say WHY it is false.
   */
  async isAvailable(): Promise<boolean> {
    return (await this.getAvailability()).available;
  }

  /**
   * Get runner status
   */
  async getStatus(): Promise<RunnerStatusResponse> {
    const response = await fetch(`${this.base.baseUrl}/status`, {
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(`${this.base.baseUrl}/capture-screenshot`, {
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
}
