/**
 * Base HTTP transport layer for the runner client.
 *
 * Holds the target runner, the shared failure-message builder and the generic
 * sendCommand method.
 * Sub-clients receive a BaseClient instance via constructor injection.
 */

import { runnerRequest } from "@/lib/runner/api-client";
import {
  describeRunnerOriginRefusal,
  parseRunnerOriginRefusalText,
} from "@/lib/runner/origin-refusal";
import type { RunnerTarget } from "@/lib/runner/target";

export class BaseClient {
  /**
   * The runner every sub-client call is for. The transport (loopback for a
   * runner proven local, the backend relay otherwise) is resolved per request
   * by `runnerRequest` — there is no base URL.
   */
  readonly target: RunnerTarget;

  constructor(target: RunnerTarget) {
    this.target = target;
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
    try {
      const response = await runnerRequest(this.target, "/command", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ type, params }),
        timeoutMs,
      });

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
      return {
        success: false,
        error: error instanceof Error ? error.message : "Command failed",
      };
    }
  }
}
