/**
 * Click capture (template capture) operations for the runner client.
 *
 * Handles start/stop/status for click capture sessions.
 */

import { BaseClient } from "./base-client";
import type {
  ClickCaptureStartResponse,
  ClickCaptureStopResponse,
  ClickCaptureStatusResponse,
} from "./types";

export class ClickCaptureClient {
  private base: BaseClient;

  constructor(base: BaseClient) {
    this.base = base;
  }

  async startClickCapture(
    sessionId: string,
    applicationName?: string
  ): Promise<ClickCaptureStartResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${this.base.baseUrl}/command`, {
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
        error:
          error instanceof Error
            ? error.message
            : "Failed to start click capture",
      };
    }
  }

  async stopClickCapture(): Promise<ClickCaptureStopResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min for processing

    try {
      const response = await fetch(`${this.base.baseUrl}/command`, {
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
        error:
          error instanceof Error
            ? error.message
            : "Failed to stop click capture",
      };
    }
  }

  async getClickCaptureStatus(): Promise<ClickCaptureStatusResponse> {
    try {
      const response = await fetch(`${this.base.baseUrl}/command`, {
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
        error:
          error instanceof Error
            ? error.message
            : "Failed to get click capture status",
      };
    }
  }
}
