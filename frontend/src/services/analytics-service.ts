import { HttpClient } from "./http-client";
import { ApiConfig } from "./api-config";

export interface UsageSummary {
  api_calls_today: number;
  total_projects: number;
  storage_used: number;
  last_active: string;
}

export interface MetricData {
  date: string;
  api_calls: number;
  projects_created: number;
  storage_used: number;
}

export interface AnalyticsSummary {
  total_api_calls: number;
  total_projects: number;
  total_storage: number;
  active_users: number;
  metrics: MetricData[];
}

export interface StorageBreakdown {
  avatars: number;
  images: number;
  screenshots: number;
  exports: number;
}

export interface ActivityItem {
  id: string;
  type: "create" | "update" | "delete" | "export" | "run";
  description: string;
  timestamp: string;
  project_name?: string;
}

export class AnalyticsService {
  private httpClient: HttpClient;
  private apiUrl: string;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.apiUrl = ApiConfig.API_BASE_URL;
  }

  async getUsageSummary(): Promise<UsageSummary> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/analytics/usage`
    );
    if (!response.ok) {
      throw new Error("Failed to get usage summary");
    }
    return response.json();
  }

  async getMetrics(days?: number): Promise<MetricData[]> {
    const queryParam = days ? `?days=${days}` : "";
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/analytics/metrics${queryParam}`
    );
    if (!response.ok) {
      throw new Error("Failed to get metrics");
    }
    return response.json();
  }

  async getAnalyticsSummary(days?: number): Promise<AnalyticsSummary> {
    const queryParam = days ? `?days=${days}` : "";
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/analytics/summary${queryParam}`
    );
    if (!response.ok) {
      throw new Error("Failed to get analytics summary");
    }
    return response.json();
  }

  async getStorageBreakdown(): Promise<StorageBreakdown> {
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/analytics/storage-breakdown`
    );
    if (!response.ok) {
      throw new Error("Failed to get storage breakdown");
    }
    return response.json();
  }

  async getActivityTimeline(limit?: number): Promise<ActivityItem[]> {
    const queryParam = limit ? `?limit=${limit}` : "";
    const response = await this.httpClient.fetch(
      `${this.apiUrl}/api/v1/analytics/activity${queryParam}`
    );
    if (!response.ok) {
      throw new Error("Failed to get activity timeline");
    }
    return response.json();
  }
}
