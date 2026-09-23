/**
 * Web extraction operations for the runner client.
 *
 * Handles start/stop/status/screenshot for web extraction sessions.
 */

import {
  isRunnerNeedsLocalError,
  runnerRequest,
} from "@/lib/runner/api-client";
import { BaseClient } from "./base-client";
import type {
  StartExtractionRequest,
  ExtractionStartResponse,
  ExtractionStatusResponse,
} from "./types";

/**
 * The runner path of an extraction screenshot. Fetch it through
 * `runnerRequest` / `useRunnerObjectUrl`, never as a raw URL.
 */
export function extractionScreenshotPath(
  extractionId: string,
  screenshotId: string
): string {
  return `/extraction/${extractionId}/screenshot/${screenshotId}`;
}

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
    try {
      const response = await runnerRequest(
        this.base.target,
        "/extraction/start",
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
          "Failed to start extraction"
        );
        return {
          success: false,
          error: message,
        };
      }

      return response.json();
    } catch (error) {
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
      const response = await runnerRequest(
        this.base.target,
        "/extraction/stop",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to stop extraction"
        );
        return {
          success: false,
          error: message,
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
      const response = await runnerRequest(
        this.base.target,
        "/extraction/status",
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
          timeoutMs: 5000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to get extraction status"
        );
        return {
          success: false,
          error: message,
        };
      }

      return response.json();
    } catch (error) {
      // A relay refusal is final for this route: rethrow it typed so the
      // poller stops (and can show it) instead of retrying a flattened error.
      if (isRunnerNeedsLocalError(error)) throw error;
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
   * Get extraction screenshot path
   *
   * Returns the runner path of a screenshot (fetch it through
   * `runnerRequest` / `getExtractionScreenshot`, never as a raw URL).
   * The screenshot is stored locally on the runner machine.
   */
  getExtractionScreenshotPath(
    extractionId: string,
    screenshotId: string
  ): string {
    return extractionScreenshotPath(extractionId, screenshotId);
  }

  /**
   * Fetch extraction screenshot as a blob
   */
  async getExtractionScreenshot(
    extractionId: string,
    screenshotId: string
  ): Promise<{ success: boolean; blob?: Blob; error?: string }> {
    try {
      const path = this.getExtractionScreenshotPath(extractionId, screenshotId);
      const response = await runnerRequest(this.base.target, path, {
        method: "GET",
        timeoutMs: 10000,
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { success: false, error: "Screenshot not found" };
        }
        const message = await this.base.failureMessage(
          response,
          "Failed to fetch screenshot",
          {
            includeBody: false,
          }
        );
        return {
          success: false,
          error: message,
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
