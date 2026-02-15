/**
 * Service for managing Task Runs
 *
 * Provides methods for CRUD operations on task runs, sessions, and findings.
 * Maps to the backend API endpoints at /api/v1/task-runs.
 */

import { HttpClient } from "./http-client";
import type {
  TaskRunBackend,
  TaskRunCreate,
  TaskRunBackendDetail,
  TaskRunFilters,
  TaskRunFinding,
  TaskRunFindingCreate,
  TaskRunFindingFilters,
  TaskRunFindingsListResponse,
  TaskRunFindingUpdate,
  TaskRunListResponse,
  TaskRunUpdate,
  FindingsSummary,
  VerificationResultsListResponse,
} from "@/types/task-runs";

/**
 * Service for Task Run operations
 */
export class TaskRunsService {
  constructor(private httpClient: HttpClient) {}

  /**
   * Create a new task run
   *
   * @param data - Task run creation data
   * @returns Created TaskRunBackend
   */
  async createTask(data: TaskRunCreate): Promise<TaskRunBackend> {
    return await this.httpClient.post<TaskRunBackend>(
      "/api/v1/task-runs",
      data
    );
  }

  /**
   * List task runs with optional filters
   *
   * @param filters - Optional filters (project_id, status, date range, pagination)
   * @returns TaskRunListResponse with tasks and pagination
   */
  async listTasks(filters?: TaskRunFilters): Promise<TaskRunListResponse> {
    const params = new URLSearchParams();

    if (filters) {
      if (filters.project_id) params.append("project_id", filters.project_id);
      if (filters.status) params.append("status", filters.status);
      if (filters.start_date) params.append("start_date", filters.start_date);
      if (filters.end_date) params.append("end_date", filters.end_date);
      if (filters.offset !== undefined)
        params.append("offset", String(filters.offset));
      if (filters.limit !== undefined)
        params.append("limit", String(filters.limit));
    }

    const queryString = params.toString();
    const url = `/api/v1/task-runs${queryString ? `?${queryString}` : ""}`;

    return await this.httpClient.get<TaskRunListResponse>(url);
  }

  /**
   * Get a single task run by ID (basic info)
   *
   * @param taskId - ID of the task run
   * @returns TaskRunBackend or null if not found
   */
  async getTask(taskId: string): Promise<TaskRunBackend> {
    return await this.httpClient.get<TaskRunBackend>(
      `/api/v1/task-runs/${taskId}`
    );
  }

  /**
   * Get detailed task run information with sessions and findings
   *
   * @param taskId - ID of the task run
   * @returns TaskRunBackendDetail with sessions, findings, and summary
   */
  async getTaskDetail(taskId: string): Promise<TaskRunBackendDetail> {
    return await this.httpClient.get<TaskRunBackendDetail>(
      `/api/v1/task-runs/${taskId}`
    );
  }

  /**
   * Update a task run
   *
   * @param taskId - ID of the task run
   * @param data - Update data
   * @returns Updated TaskRunBackend
   */
  async updateTask(
    taskId: string,
    data: TaskRunUpdate
  ): Promise<TaskRunBackend> {
    return await this.httpClient.put<TaskRunBackend>(
      `/api/v1/task-runs/${taskId}`,
      data
    );
  }

  /**
   * Delete a task run
   *
   * @param taskId - ID of the task run
   */
  async deleteTask(taskId: string): Promise<void> {
    await this.httpClient.delete(`/api/v1/task-runs/${taskId}`);
  }

  /**
   * Sync findings for a task run (create or update based on signature_hash)
   *
   * @param taskId - ID of the task run
   * @param findings - Array of findings to sync
   * @returns Array of created/updated findings
   */
  async syncFindings(
    taskId: string,
    findings: TaskRunFindingCreate[]
  ): Promise<TaskRunFinding[]> {
    return await this.httpClient.post<TaskRunFinding[]>(
      `/api/v1/task-runs/${taskId}/findings`,
      { findings }
    );
  }

  /**
   * List findings for a task run with optional filters
   *
   * @param taskId - ID of the task run
   * @param filters - Optional filters (category, severity, status)
   * @returns TaskRunFindingsListResponse with findings and summary
   */
  async listFindings(
    taskId: string,
    filters?: TaskRunFindingFilters
  ): Promise<TaskRunFindingsListResponse> {
    const params = new URLSearchParams();

    if (filters) {
      if (filters.category) params.append("category", filters.category);
      if (filters.severity) params.append("severity", filters.severity);
      if (filters.status) params.append("status", filters.status);
    }

    const queryString = params.toString();
    const url = `/api/v1/task-runs/${taskId}/findings${queryString ? `?${queryString}` : ""}`;

    return await this.httpClient.get<TaskRunFindingsListResponse>(url);
  }

  /**
   * Update a finding
   *
   * @param taskId - ID of the task run
   * @param findingId - ID of the finding
   * @param data - Update data
   * @returns Updated TaskRunFinding
   */
  async updateFinding(
    taskId: string,
    findingId: string,
    data: TaskRunFindingUpdate
  ): Promise<TaskRunFinding> {
    return await this.httpClient.put<TaskRunFinding>(
      `/api/v1/task-runs/${taskId}/findings/${findingId}`,
      data
    );
  }

  /**
   * Submit a user response to a finding that needs input
   *
   * @param taskId - ID of the task run
   * @param findingId - ID of the finding
   * @param response - User's response
   * @returns Updated TaskRunFinding
   */
  async submitFindingResponse(
    taskId: string,
    findingId: string,
    response: string
  ): Promise<TaskRunFinding> {
    return await this.httpClient.post<TaskRunFinding>(
      `/api/v1/task-runs/${taskId}/findings/${findingId}/response`,
      { response }
    );
  }

  /**
   * List verification results for a task run
   *
   * @param taskId - ID of the task run
   * @returns VerificationResultsListResponse with results and summary counts
   */
  async listVerificationResults(
    taskId: string
  ): Promise<VerificationResultsListResponse> {
    return await this.httpClient.get<VerificationResultsListResponse>(
      `/api/v1/task-runs/${taskId}/verification-results`
    );
  }

  /**
   * Get findings summary across all task runs
   *
   * @returns FindingsSummary with totals by severity, category, and status
   */
  async getFindingsSummary(): Promise<FindingsSummary> {
    return await this.httpClient.get<FindingsSummary>(
      "/api/v1/task-runs/findings-summary"
    );
  }
}
