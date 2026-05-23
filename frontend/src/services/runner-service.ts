import type { Runner } from "@qontinui/shared-types";
import type {
  RunnerSessionFilters,
  RunnerSessionsResponse,
  DispatchPayload,
  DispatchResult,
} from "@/types/runner";
import { HttpClient } from "./http-client";

/**
 * RunnerService — wraps the unified `/api/v1/devices` endpoint surface.
 *
 * Backed by the canonical {@link Runner} entity. Replaces the legacy
 * connection-tracking flow that hit `/runners/connections/*`.
 */
export class RunnerService {
  private httpClient: HttpClient;
  private baseUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.baseUrl = "/api/v1";
  }

  /**
   * List runners. Optionally filter by derived status (comma-separated
   * list, e.g. `"healthy,degraded,starting"`).
   */
  async getRunners(status?: string): Promise<Runner[]> {
    const url = status
      ? `${this.baseUrl}/devices?status=${encodeURIComponent(status)}`
      : `${this.baseUrl}/devices`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error("Failed to fetch runners");
    }

    return response.json();
  }

  async getRunner(runnerId: string): Promise<Runner> {
    const response = await this.httpClient.fetch(
      `${this.baseUrl}/devices/${runnerId}`
    );
    if (!response.ok) {
      throw new Error("Failed to fetch runner");
    }
    return response.json();
  }

  async deleteRunner(runnerId: string): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.baseUrl}/devices/${runnerId}`,
      { method: "DELETE" }
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to deregister runner" }));
      throw new Error(error.detail || "Failed to deregister runner");
    }
  }

  /**
   * Dispatch a workflow to a runner. Returns 503 if the runner is not
   * WebSocket-connected.
   */
  async dispatchToRunner(
    runnerId: string,
    body: DispatchPayload
  ): Promise<DispatchResult> {
    const response = await this.httpClient.fetch(
      `${this.baseUrl}/devices/${runnerId}/dispatch`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to dispatch workflow" }));
      throw new Error(error.detail || "Failed to dispatch workflow");
    }

    return response.json();
  }

  /** Fetch session history (audit log). */
  async getSessionHistory(
    filters: RunnerSessionFilters = {}
  ): Promise<RunnerSessionsResponse> {
    const params = new URLSearchParams();
    if (filters.limit !== undefined) params.set("limit", String(filters.limit));
    if (filters.offset !== undefined)
      params.set("offset", String(filters.offset));
    if (filters.search) params.set("search", filters.search);
    if (filters.start_date) params.set("start_date", filters.start_date);
    if (filters.end_date) params.set("end_date", filters.end_date);
    if (filters.runner_id) params.set("runner_id", filters.runner_id);

    const url = `${this.baseUrl}/devices/connections${
      params.toString() ? `?${params.toString()}` : ""
    }`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error("Failed to fetch session history");
    }

    return response.json();
  }
}
