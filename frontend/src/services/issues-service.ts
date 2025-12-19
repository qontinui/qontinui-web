/**
 * Issues Service - API client for detected issues
 *
 * Provides methods for managing issues detected during AI-assisted automation sessions.
 */

import { HttpClient } from "./http-client";
import type {
  DetectedIssue,
  DetectedIssueCreate,
  DetectedIssueUpdate,
  IssueFilters,
  IssueListResponse,
  IssueStats,
} from "@/types/detected-issue";

const BASE_URL = "/api/v1/issues";

export interface IssueSyncItem {
  id: string;
  session_id: string;
  type: string;
  severity: string;
  title: string;
  description?: string;
  file?: string;
  line?: number;
  source: {
    type: string;
    path?: string;
    line_range?: [number, number];
    description?: string;
  };
  status: string;
  resolution?: string;
  detected_at: string;
  resolved_at?: string;
}

export interface IssuesSyncRequest {
  project_id?: string;
  issues: IssueSyncItem[];
}

export interface IssuesSyncResponse {
  synced: number;
  updated: number;
  errors: string[];
}

export class IssuesService {
  private httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * Get a list of detected issues with optional filters
   */
  async getIssues(filters?: IssueFilters): Promise<IssueListResponse> {
    const params = new URLSearchParams();

    if (filters?.project_id) {
      params.append("project_id", filters.project_id);
    }
    if (filters?.session_id) {
      params.append("session_id", filters.session_id);
    }
    if (filters?.status) {
      params.append("status", filters.status);
    }
    if (filters?.severity) {
      params.append("severity", filters.severity);
    }
    if (filters?.type) {
      params.append("type", filters.type);
    }

    const queryString = params.toString();
    const url = queryString ? `${BASE_URL}?${queryString}` : BASE_URL;

    return this.httpClient.get<IssueListResponse>(url);
  }

  /**
   * Get a single issue by ID
   */
  async getIssue(id: string): Promise<DetectedIssue> {
    return this.httpClient.get<DetectedIssue>(`${BASE_URL}/${id}`);
  }

  /**
   * Create a new detected issue
   */
  async createIssue(data: DetectedIssueCreate): Promise<DetectedIssue> {
    return this.httpClient.post<DetectedIssue>(BASE_URL, data);
  }

  /**
   * Update an existing issue
   */
  async updateIssue(
    id: string,
    data: DetectedIssueUpdate
  ): Promise<DetectedIssue> {
    return this.httpClient.patch<DetectedIssue>(`${BASE_URL}/${id}`, data);
  }

  /**
   * Delete an issue
   */
  async deleteIssue(id: string): Promise<void> {
    return this.httpClient.delete(`${BASE_URL}/${id}`);
  }

  /**
   * Get issue statistics
   */
  async getStats(projectId?: string): Promise<IssueStats> {
    const params = new URLSearchParams();
    if (projectId) {
      params.append("project_id", projectId);
    }

    const queryString = params.toString();
    const url = queryString ? `${BASE_URL}/stats?${queryString}` : `${BASE_URL}/stats`;

    return this.httpClient.get<IssueStats>(url);
  }

  /**
   * Sync issues from runner
   */
  async syncIssues(request: IssuesSyncRequest): Promise<IssuesSyncResponse> {
    return this.httpClient.post<IssuesSyncResponse>(`${BASE_URL}/sync`, request);
  }
}
