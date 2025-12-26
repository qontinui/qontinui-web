import { HttpClient } from "./http-client";
import type {
  RunnerConnection,
  ConnectionHistoryParams,
  ConnectionHistoryResponse,
} from "@/types/runner";

/**
 * RunnerService - Handles desktop runner connection tracking
 */
export class RunnerService {
  private httpClient: HttpClient;
  private baseUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.baseUrl = "/api/v1";
  }

  /**
   * Connection Management
   */

  async getActiveConnections(): Promise<RunnerConnection[]> {
    const response = await this.httpClient.fetch(
      `${this.baseUrl}/runners/connections/active`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch active connections");
    }

    return response.json();
  }

  async getConnectionHistory(
    params: ConnectionHistoryParams = {}
  ): Promise<ConnectionHistoryResponse> {
    const queryParams = new URLSearchParams();

    if (params.limit) queryParams.append("limit", params.limit.toString());
    if (params.offset) queryParams.append("offset", params.offset.toString());
    if (params.search) queryParams.append("search", params.search);
    if (params.start_date) queryParams.append("start_date", params.start_date);
    if (params.end_date) queryParams.append("end_date", params.end_date);

    const url = `${this.baseUrl}/runners/connections?${queryParams.toString()}`;
    const response = await this.httpClient.fetch(url);

    if (!response.ok) {
      throw new Error("Failed to fetch connection history");
    }

    return response.json();
  }

  async disconnectRunner(connectionId: number): Promise<void> {
    const response = await this.httpClient.fetch(
      `${this.baseUrl}/runners/connections/${connectionId}/disconnect`,
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: "Failed to disconnect runner" }));
      throw new Error(error.detail || "Failed to disconnect runner");
    }
  }
}
