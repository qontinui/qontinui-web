/**
 * Pattern matching operations for the runner client.
 *
 * Handles patternFind and patternFindAll for template matching.
 */

import { runnerRequest } from "@/lib/runner/api-client";
import { BaseClient } from "./base-client";
import type { PatternMatchRequest, PatternMatchResponse } from "./types";

export class PatternClient {
  private base: BaseClient;

  constructor(base: BaseClient) {
    this.base = base;
  }

  /**
   * Find the best match of a template in a screenshot
   */
  async patternFind(
    request: PatternMatchRequest
  ): Promise<PatternMatchResponse> {
    try {
      const response = await runnerRequest(this.base.target, "/pattern/find", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
        timeoutMs: 30000,
      });

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to find pattern"
        );
        return {
          success: false,
          matches: [],
          search_time_ms: 0,
          screenshot_width: 0,
          screenshot_height: 0,
          template_width: 0,
          template_height: 0,
          error: message,
        };
      }

      const data = await response.json();
      // Handle nested response format from runner API
      if (data.data) {
        return {
          success: data.success ?? true,
          ...data.data,
          error: data.error,
        };
      }
      return data;
    } catch (error) {
      return {
        success: false,
        matches: [],
        search_time_ms: 0,
        screenshot_width: 0,
        screenshot_height: 0,
        template_width: 0,
        template_height: 0,
        error:
          error instanceof Error ? error.message : "Failed to find pattern",
      };
    }
  }

  /**
   * Find all matches of a template in a screenshot
   */
  async patternFindAll(
    request: PatternMatchRequest
  ): Promise<PatternMatchResponse> {
    try {
      const response = await runnerRequest(
        this.base.target,
        "/pattern/find-all",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(request),
          // find_all scans the whole screen
          timeoutMs: 60000,
        }
      );

      if (!response.ok) {
        const message = await this.base.failureMessage(
          response,
          "Failed to find all patterns"
        );
        return {
          success: false,
          matches: [],
          search_time_ms: 0,
          screenshot_width: 0,
          screenshot_height: 0,
          template_width: 0,
          template_height: 0,
          error: message,
        };
      }

      const data = await response.json();
      // Handle nested response format from runner API
      if (data.data) {
        return {
          success: data.success ?? true,
          ...data.data,
          error: data.error,
        };
      }
      return data;
    } catch (error) {
      return {
        success: false,
        matches: [],
        search_time_ms: 0,
        screenshot_width: 0,
        screenshot_height: 0,
        template_width: 0,
        template_height: 0,
        error:
          error instanceof Error
            ? error.message
            : "Failed to find all patterns",
      };
    }
  }
}
