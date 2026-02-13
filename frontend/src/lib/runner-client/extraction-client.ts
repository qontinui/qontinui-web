/**
 * Web extraction operations for the runner client.
 *
 * Handles start/stop/status/screenshot for web extraction sessions.
 */

import { BaseClient } from "./base-client";
import type {
  StartExtractionRequest,
  ExtractionStartResponse,
  ExtractionStatusResponse,
} from "./types";

export class ExtractionClient {
  private base: BaseClient;

  constructor(base: BaseClient) {
    this.base = base;
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
      const response = await fetch(`${this.base.baseUrl}/extraction/start`, {
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
      const response = await fetch(`${this.base.baseUrl}/extraction/stop`, {
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
      const response = await fetch(`${this.base.baseUrl}/extraction/status`, {
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
    return `${this.base.baseUrl}/extraction/${extractionId}/screenshot/${screenshotId}`;
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
