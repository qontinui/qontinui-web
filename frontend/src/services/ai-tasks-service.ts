/**
 * Service for managing AI Tasks
 *
 * Provides methods for CRUD operations on AI tasks, sessions, and findings.
 * Maps to the backend API endpoints at /api/v1/ai-tasks.
 */

import { HttpClient } from "./http-client";
import type {
  AITask,
  AITaskCreate,
  AITaskDetail,
  AITaskFilters,
  AITaskFinding,
  AITaskFindingCreate,
  AITaskFindingFilters,
  AITaskFindingsListResponse,
  AITaskFindingUpdate,
  AITaskListResponse,
  AITaskUpdate,
} from "@/types/ai-tasks";

/**
 * Service for AI Task operations
 */
export class AITasksService {
  constructor(private httpClient: HttpClient) {}

  /**
   * Create a new AI task
   *
   * @param data - Task creation data
   * @returns Created AITask
   */
  async createTask(data: AITaskCreate): Promise<AITask> {
    return await this.httpClient.post<AITask>("/api/v1/ai-tasks", data);
  }

  /**
   * List AI tasks with optional filters
   *
   * @param filters - Optional filters (project_id, status, date range, pagination)
   * @returns AITaskListResponse with tasks and pagination
   */
  async listTasks(filters?: AITaskFilters): Promise<AITaskListResponse> {
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
    const url = `/api/v1/ai-tasks${queryString ? `?${queryString}` : ""}`;

    return await this.httpClient.get<AITaskListResponse>(url);
  }

  /**
   * Get a single AI task by ID (basic info)
   *
   * @param taskId - ID of the task
   * @returns AITask or null if not found
   */
  async getTask(taskId: string): Promise<AITask> {
    return await this.httpClient.get<AITask>(`/api/v1/ai-tasks/${taskId}`);
  }

  /**
   * Get detailed AI task information with sessions and findings
   *
   * @param taskId - ID of the task
   * @returns AITaskDetail with sessions, findings, and summary
   */
  async getTaskDetail(taskId: string): Promise<AITaskDetail> {
    return await this.httpClient.get<AITaskDetail>(
      `/api/v1/ai-tasks/${taskId}`
    );
  }

  /**
   * Update an AI task
   *
   * @param taskId - ID of the task
   * @param data - Update data
   * @returns Updated AITask
   */
  async updateTask(taskId: string, data: AITaskUpdate): Promise<AITask> {
    return await this.httpClient.put<AITask>(
      `/api/v1/ai-tasks/${taskId}`,
      data
    );
  }

  /**
   * Delete an AI task
   *
   * @param taskId - ID of the task
   */
  async deleteTask(taskId: string): Promise<void> {
    await this.httpClient.delete(`/api/v1/ai-tasks/${taskId}`);
  }

  /**
   * Sync findings for a task (create or update based on signature_hash)
   *
   * @param taskId - ID of the task
   * @param findings - Array of findings to sync
   * @returns Array of created/updated findings
   */
  async syncFindings(
    taskId: string,
    findings: AITaskFindingCreate[]
  ): Promise<AITaskFinding[]> {
    return await this.httpClient.post<AITaskFinding[]>(
      `/api/v1/ai-tasks/${taskId}/findings`,
      { findings }
    );
  }

  /**
   * List findings for a task with optional filters
   *
   * @param taskId - ID of the task
   * @param filters - Optional filters (category, severity, status)
   * @returns AITaskFindingsListResponse with findings and summary
   */
  async listFindings(
    taskId: string,
    filters?: AITaskFindingFilters
  ): Promise<AITaskFindingsListResponse> {
    const params = new URLSearchParams();

    if (filters) {
      if (filters.category) params.append("category", filters.category);
      if (filters.severity) params.append("severity", filters.severity);
      if (filters.status) params.append("status", filters.status);
    }

    const queryString = params.toString();
    const url = `/api/v1/ai-tasks/${taskId}/findings${queryString ? `?${queryString}` : ""}`;

    return await this.httpClient.get<AITaskFindingsListResponse>(url);
  }

  /**
   * Update a finding
   *
   * @param taskId - ID of the task
   * @param findingId - ID of the finding
   * @param data - Update data
   * @returns Updated AITaskFinding
   */
  async updateFinding(
    taskId: string,
    findingId: string,
    data: AITaskFindingUpdate
  ): Promise<AITaskFinding> {
    return await this.httpClient.put<AITaskFinding>(
      `/api/v1/ai-tasks/${taskId}/findings/${findingId}`,
      data
    );
  }

  /**
   * Submit a user response to a finding that needs input
   *
   * @param taskId - ID of the task
   * @param findingId - ID of the finding
   * @param response - User's response
   * @returns Updated AITaskFinding
   */
  async submitFindingResponse(
    taskId: string,
    findingId: string,
    response: string
  ): Promise<AITaskFinding> {
    return await this.httpClient.post<AITaskFinding>(
      `/api/v1/ai-tasks/${taskId}/findings/${findingId}/response`,
      { response }
    );
  }
}
