/**
 * Base HTTP transport layer for the runner client.
 *
 * Provides the shared configuration constants and generic sendCommand method.
 * Sub-clients receive a BaseClient instance via constructor injection.
 */

import {
  describeRunnerOriginRefusal,
  parseRunnerOriginRefusalText,
} from "@/lib/runner/origin-refusal";

// Default runner URL - can be overridden via environment variable
// Use 127.0.0.1 instead of localhost to force IPv4 (runner only listens on IPv4)
export const RUNNER_BASE_URL =
  process.env.NEXT_PUBLIC_RUNNER_URL || "http://127.0.0.1:9876";

export class BaseClient {
  readonly baseUrl: string;

  constructor(baseUrl: string = RUNNER_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * The error message for a non-2xx runner response — the one place every
   * sub-client's `!response.ok` branch builds it.
   *
   * A 403 carrying the runner's typed origin-guard refusal
   * (`CROSS_ORIGIN_REFUSED`, plan
   * `2026-09-17-runner-loopback-api-accepts-any-origin`) is described as that
   * refusal — route, origin and how to admit it — instead of reading as a
   * broken runner. Anything else keeps the existing
   * `<prefix>: <status> - <body>` shape, or `<prefix>: <status>` with
   * `includeBody: false`. A status-only branch reads the body ONLY for a 403,
   * since no other status can be the refusal.
   */
  async failureMessage(
    response: Response,
    prefix: string,
    { includeBody = true }: { includeBody?: boolean } = {}
  ): Promise<string> {
    if (!includeBody && response.status !== 403) {
      return `${prefix}: ${response.status}`;
    }
    const text = await response.text();
    const refusal =
      response.status === 403 ? parseRunnerOriginRefusalText(text) : null;
    if (refusal) return describeRunnerOriginRefusal(refusal);
    return includeBody
      ? `${prefix}: ${response.status} - ${text}`
      : `${prefix}: ${response.status}`;
  }

  /**
   * Send a generic command to the runner
   */
  async sendCommand<T = unknown>(
    type: string,
    params: Record<string, unknown> = {},
    timeoutMs = 120000
  ): Promise<{ success: boolean; result?: T; error?: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/command`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ type, params }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          error: await this.failureMessage(response, "Command failed"),
        };
      }

      const data = await response.json();
      return {
        success: data.success ?? true,
        result: data.data as T,
        error: data.error,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Command failed",
      };
    }
  }
}
