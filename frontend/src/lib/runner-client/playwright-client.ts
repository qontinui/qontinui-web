/**
 * Playwright state collection operations for the runner client.
 *
 * Handles start/stop/status/results for Playwright-based state collection.
 */

import {
  isRunnerNeedsLocalError,
  runnerRequest,
} from "@/lib/runner/api-client";
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
    try {
      const response = await runnerRequest(
        this.base.target,
        "/playwright-collection/start",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(request),
          timeoutMs: 60000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to start Playwright collection"
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

      const path = `/playwright-collection/status${params.toString() ? `?${params.toString()}` : ""}`;

      const response = await runnerRequest(this.base.target, path, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        timeoutMs: 10000,
      });

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to get Playwright collection status"
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
    try {
      const params = new URLSearchParams();
      if (jobId) {
        params.set("job_id", jobId);
      }

      const path = `/playwright-collection/results${params.toString() ? `?${params.toString()}` : ""}`;

      const response = await runnerRequest(this.base.target, path, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        // Large result sets take a while to serialize.
        timeoutMs: 120000,
      });

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to get Playwright collection results"
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
      const response = await runnerRequest(
        this.base.target,
        "/playwright-collection/stop",
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
          "Failed to stop Playwright collection"
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
          error instanceof Error
            ? error.message
            : "Failed to stop Playwright collection",
      };
    }
  }
}
