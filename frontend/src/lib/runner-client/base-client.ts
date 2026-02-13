/**
 * Base HTTP transport layer for the runner client.
 *
 * Provides the shared configuration constants and generic sendCommand method.
 * Sub-clients receive a BaseClient instance via constructor injection.
 */

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
        const errorText = await response.text();
        return {
          success: false,
          error: `Command failed: ${response.status} - ${errorText}`,
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
