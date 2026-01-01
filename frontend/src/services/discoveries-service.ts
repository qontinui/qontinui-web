import { HttpClient } from "./http-client";
import type {
  Discovery,
  DiscoveryFilters,
  DiscoveriesResponse,
  PendingCountResponse,
} from "@/types/discoveries";

/**
 * DiscoveriesService - Handles pending discoveries from runners
 */
export class DiscoveriesService {
  private httpClient: HttpClient;
  private baseUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.baseUrl = "/api/v1/discoveries";
  }

  /**
   * Get discoveries with optional filters
   */
  async getDiscoveries(
    filters: DiscoveryFilters = {},
    limit = 50,
    offset = 0
  ): Promise<DiscoveriesResponse> {
    const queryParams = new URLSearchParams();

    if (filters.status) queryParams.append("status", filters.status);
    if (filters.project_id)
      queryParams.append("project_id", filters.project_id);
    if (filters.discovery_type)
      queryParams.append("discovery_type", filters.discovery_type);
    queryParams.append("limit", limit.toString());
    queryParams.append("offset", offset.toString());

    return this.httpClient.get<DiscoveriesResponse>(
      `${this.baseUrl}?${queryParams.toString()}`
    );
  }

  /**
   * Get a single discovery by ID
   */
  async getDiscovery(id: string): Promise<Discovery> {
    return this.httpClient.get<Discovery>(`${this.baseUrl}/${id}`);
  }

  /**
   * Accept a discovery with optional notes
   */
  async acceptDiscovery(id: string, notes?: string): Promise<Discovery> {
    return this.httpClient.post<Discovery>(`${this.baseUrl}/${id}/accept`, {
      user_notes: notes,
    });
  }

  /**
   * Reject a discovery with optional notes
   */
  async rejectDiscovery(id: string, notes?: string): Promise<Discovery> {
    return this.httpClient.post<Discovery>(`${this.baseUrl}/${id}/reject`, {
      user_notes: notes,
    });
  }

  /**
   * Get the count of pending discoveries
   */
  async getPendingCount(): Promise<PendingCountResponse> {
    return this.httpClient.get<PendingCountResponse>(
      `${this.baseUrl}/pending-count`
    );
  }
}
