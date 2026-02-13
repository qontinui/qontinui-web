/**
 * Playwright state collection operations for the runner client.
 *
 * Handles start/stop/status/results for Playwright-based state collection.
 */

import { BaseClient } from "./base-client";
import type {
  StartPlaywrightCollectionRequest,
  PlaywrightCollectionStartResponse,
  PlaywrightCollectionStatusResponse,
  PlaywrightCollectionResultsResponse,
} from "./types";

export class PlaywrightClient {
  private base: BaseClient;

  constructor(base: BaseClient) {
    this.base = base;
  }

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
        `${this.base.baseUrl}/playwright-collection/start`,
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

      const url = `${this.base.baseUrl}/playwright-collection/status${params.toString() ? `?${params.toString()}` : ""}`;

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

      const url = `${this.base.baseUrl}/playwright-collection/results${params.toString() ? `?${params.toString()}` : ""}`;

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
        `${this.base.baseUrl}/playwright-collection/stop`,
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
}
