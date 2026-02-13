/**
 * Config, status, and screenshot operations for the runner client.
 *
 * Handles loadConfig, getMonitors, isAvailable, getStatus, and captureScreenshot.
 */

import { BaseClient } from "./base-client";
import type {
  MonitorsResponse,
  RunnerStatusResponse,
  LoadConfigResponse,
  CaptureScreenshotRequest,
  CaptureScreenshotResponse,
} from "./types";

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
      const response = await fetch(`${this.base.baseUrl}/monitors`, {
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
      const response = await fetch(`${this.base.baseUrl}/status`, {
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
    const response = await fetch(`${this.base.baseUrl}/status`, {
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
}
