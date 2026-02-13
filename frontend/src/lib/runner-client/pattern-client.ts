/**
 * Pattern matching operations for the runner client.
 *
 * Handles patternFind and patternFindAll for template matching.
 */

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(`${this.base.baseUrl}/pattern/find`, {
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
          matches: [],
          search_time_ms: 0,
          screenshot_width: 0,
          screenshot_height: 0,
          template_width: 0,
          template_height: 0,
          error: `Failed to find pattern: ${response.status} - ${errorText}`,
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
      clearTimeout(timeoutId);
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout for find_all

    try {
      const response = await fetch(`${this.base.baseUrl}/pattern/find-all`, {
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
          matches: [],
          search_time_ms: 0,
          screenshot_width: 0,
          screenshot_height: 0,
          template_width: 0,
          template_height: 0,
          error: `Failed to find all patterns: ${response.status} - ${errorText}`,
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
      clearTimeout(timeoutId);
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
