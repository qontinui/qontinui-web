import { authService, tokenManager } from "@/services/service-factory";
import { TokenValidator } from "@/services/auth/token-validator";
import { csrfService } from "@/services/csrf-service";
import type {
  User,
  Project,
  UserUpdate,
  ProjectCreate,
  ProjectUpdate,
} from "@/lib/api-client/types";
import type {
  AutomationSession,
  Screenshot,
  AutomationLog,
} from "@/types/automation";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Re-export types for backwards compatibility
export type { User, Project, UserUpdate, ProjectCreate, ProjectUpdate };

// Finding Category types
export type FindingCategoryActionType =
  | "auto_fix"
  | "needs_user_input"
  | "manual"
  | "informational";

export interface FindingCategoryConfig {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  is_built_in: boolean;
  default_action_type: FindingCategoryActionType;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface FindingCategoryConfigCreate {
  slug: string;
  name: string;
  description?: string;
  icon: string;
  color: string;
  default_action_type: FindingCategoryActionType;
  sort_order: number;
  enabled?: boolean;
}

export interface FindingCategoryConfigUpdate {
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  default_action_type?: FindingCategoryActionType;
  sort_order?: number;
  enabled?: boolean;
}

// Workflow Step Type Config types
export type WorkflowPhase = "setup" | "verification" | "agentic" | "completion";

export interface StepTypeConfig {
  id: string;
  user_id: string;
  step_type: string;
  phase: WorkflowPhase;
  label: string;
  description: string;
  icon: string;
  color: string;
  is_built_in: boolean;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface StepTypeConfigCreate {
  step_type: string;
  phase: WorkflowPhase;
  label: string;
  description?: string;
  icon: string;
  color: string;
  sort_order: number;
  enabled?: boolean;
}

export interface StepTypeConfigUpdate {
  label?: string;
  description?: string;
  icon?: string;
  color?: string;
  sort_order?: number;
  enabled?: boolean;
}

// GUI Action Type Config types
export interface GuiActionTypeConfig {
  id: string;
  user_id: string;
  action_type: string;
  label: string;
  description: string;
  icon: string;
  is_built_in: boolean;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface GuiActionTypeConfigCreate {
  action_type: string;
  label: string;
  description?: string;
  icon: string;
  sort_order: number;
  enabled?: boolean;
}

export interface GuiActionTypeConfigUpdate {
  label?: string;
  description?: string;
  icon?: string;
  sort_order?: number;
  enabled?: boolean;
}

// Workflow Phase Config types
export interface WorkflowPhaseConfig {
  id: string;
  user_id: string;
  phase: WorkflowPhase;
  label: string;
  description: string;
  color: string;
  is_built_in: boolean;
  sort_order: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkflowPhaseConfigUpdate {
  label?: string;
  description?: string;
  color?: string;
  sort_order?: number;
  enabled?: boolean;
}

// Image types
export interface ImageUploadResponse {
  image_id: string;
  // Fields returned by backend after upload
  s3_key: string;
  presigned_url: string; // Primary URL field from backend
  size: number;
  content_type: string;
  created_at: string;
  status: "processing" | "completed";
  job_id?: string | null;
  // Fields returned after thumbnail processing is complete
  variants?: {
    original: string;
    thumb: string;
    medium: string;
    large: string;
  };
  presigned_urls?: {
    original: string;
    thumb: string;
    medium: string;
    large: string;
  };
  // Legacy fields for backward compatibility
  url?: string;
}

export interface ImageProcessingStatus {
  status: "processing" | "completed" | "failed";
  variants?: {
    original: string;
    thumb: string;
    medium: string;
    large: string;
  };
  presigned_urls?: {
    original: string;
    thumb: string;
    medium: string;
    large: string;
  };
  error?: string;
}

/**
 * ApiClient - Single Responsibility: Handle HTTP requests with authentication
 * Manages API communication, retry logic, and token refresh
 */
class ApiClient {
  private retryAttempts = 3;

  constructor() {
    new TokenValidator();
  }

  private async fetchWithAuth(
    url: string,
    options: RequestInit = {},
    attempt = 1
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    // Token Refresh Strategy (Aligned with Backend):
    // - Backend sliding window middleware handles proactive token refresh (5min threshold)
    // - Frontend only refreshes reactively on 401 responses
    // - This prevents race conditions where both frontend and backend try to refresh simultaneously
    // - Backend sets new tokens via X-New-Access-Token and X-New-Refresh-Token headers
    //
    // Dual-mode auth:
    // - Local (same-origin backend): HttpOnly cookies carry the session;
    //   Authorization header is harmless extra info.
    // - Remote (NEXT_PUBLIC_API_URL points off-localhost, e.g. AWS staging):
    //   browser refuses to attach *.qontinui.io cookies to localhost:3001
    //   requests, so the in-memory + sessionStorage Bearer token is the only
    //   working auth path. Same shape as services/http-client.ts.
    const accessToken = tokenManager.getAccessToken();
    if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
    }

    // Add CSRF token for state-changing requests
    const csrfToken = csrfService.getToken();
    if (
      csrfToken &&
      ["POST", "PUT", "DELETE", "PATCH"].includes(options.method || "GET")
    ) {
      headers["X-CSRF-Token"] = csrfToken;
    }

    // Add timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1${url}`, {
        ...options,
        headers,
        credentials: "include",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 401 Unauthorized
      if (response.status === 401 && attempt === 1) {
        // Try to refresh the token via authService
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          // Retry the original request with new token
          return this.fetchWithAuth(url, options, attempt + 1);
        }
      }

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter) : 60;

        if (attempt <= this.retryAttempts) {
          console.warn(
            `Rate limited. Retrying after ${retryAfterSeconds} seconds...`
          );
          await new Promise((resolve) =>
            setTimeout(resolve, retryAfterSeconds * 1000)
          );
          return this.fetchWithAuth(url, options, attempt + 1);
        }

        throw new Error("Rate limit exceeded. Please try again later.");
      }

      // Handle server errors with retry
      if (response.status >= 500 && attempt <= this.retryAttempts) {
        const backoffTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.warn(`Server error. Retrying in ${backoffTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffTime));
        return this.fetchWithAuth(url, options, attempt + 1);
      }

      return response;
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Request timeout");
      }

      // Check for network errors
      if (!navigator.onLine) {
        throw new Error("No internet connection. Please check your network.");
      }

      throw error;
    }
  }

  async refreshAccessToken(): Promise<boolean> {
    return authService.refreshAccessToken();
  }

  async logout() {
    return authService.logout();
  }

  async getCurrentUser(): Promise<User> {
    return authService.getCurrentUser() as Promise<User>;
  }

  async updateCurrentUser(data: UserUpdate): Promise<User> {
    const response = await this.fetchWithAuth("/users/me", {
      method: "PUT",
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error("Failed to update user");
    }
    return response.json();
  }

  // Project endpoints
  async getProjects(): Promise<Project[]> {
    const response = await this.fetchWithAuth("/projects/");
    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        "[ApiClient] getProjects error:",
        response.status,
        errorText
      );
      throw new Error(
        `Failed to get projects: ${response.status} - ${errorText}`
      );
    }
    return response.json();
  }

  async getProject(id: number): Promise<Project> {
    const response = await this.fetchWithAuth(`/projects/${id}`);
    if (!response.ok) {
      throw new Error("Failed to get project");
    }
    return response.json();
  }

  async createProject(data: ProjectCreate): Promise<Project> {
    const response = await this.fetchWithAuth("/projects/", {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error("Failed to create project");
    }
    return response.json();
  }

  async updateProject(id: number, data: ProjectUpdate): Promise<Project> {
    const response = await this.fetchWithAuth(`/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error("Failed to update project");
    }
    return response.json();
  }

  async deleteProject(id: number): Promise<void> {
    const response = await this.fetchWithAuth(`/projects/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error("Failed to delete project");
    }
  }

  // File upload with progress
  async uploadFile(
    url: string,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("file", file);

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && onProgress) {
          const progress = (e.loaded / e.total) * 100;
          onProgress(progress);
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve(data);
          } catch {
            resolve(xhr.responseText);
          }
        } else {
          reject(new Error("Upload failed"));
        }
      });

      xhr.addEventListener("error", () => {
        reject(new Error("Network error during upload"));
      });

      xhr.addEventListener("timeout", () => {
        reject(new Error("Upload timeout"));
      });

      xhr.open("POST", `${API_BASE_URL}/api/v1${url}`);

      // HttpOnly Cookie Security: Enable credentials to send cookies
      xhr.withCredentials = true;

      const csrfToken = csrfService.getToken();
      if (csrfToken) {
        xhr.setRequestHeader("X-CSRF-Token", csrfToken);
      }

      xhr.timeout = 60000; // 60 seconds for file uploads
      xhr.send(formData);
    });
  }

  // S3 Image Storage Methods

  async uploadProjectImage(
    projectId: number,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<ImageUploadResponse> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("file", file);

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && onProgress) {
          const progress = (e.loaded / e.total) * 100;
          onProgress(progress);
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve(data);
          } catch (_error) {
            reject(new Error("Failed to parse upload response"));
          }
        } else {
          try {
            const errorData = JSON.parse(xhr.responseText);
            reject(new Error(errorData.detail || "Upload failed"));
          } catch {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      });

      xhr.addEventListener("error", () => {
        reject(new Error("Network error during upload"));
      });

      xhr.addEventListener("timeout", () => {
        reject(new Error("Upload timeout"));
      });

      xhr.open(
        "POST",
        `${API_BASE_URL}/api/v1/projects/${projectId}/images/upload`
      );

      // HttpOnly Cookie Security: Enable credentials to send cookies
      xhr.withCredentials = true;

      const csrfToken = csrfService.getToken();
      if (csrfToken) {
        xhr.setRequestHeader("X-CSRF-Token", csrfToken);
      }

      xhr.timeout = 60000; // 60 seconds for file uploads
      xhr.send(formData);
    });
  }

  async getImageUrl(
    projectId: string,
    imageId: string,
    size: "thumb" | "medium" | "large" | "original" = "medium"
  ): Promise<string> {
    const response = await this.fetchWithAuth(
      `/projects/${projectId}/images/${imageId}/url?size=${size}`,
      {
        method: "GET",
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to get image URL: ${response.status} - ${errorText}`
      );
    }

    const data = await response.json();
    return data.url;
  }

  async pollImageProcessingStatus(
    projectId: string,
    imageId: string,
    maxAttempts: number = 30
  ): Promise<ImageProcessingStatus> {
    let attempts = 0;
    const pollInterval = 1000; // 1 second

    while (attempts < maxAttempts) {
      const response = await this.fetchWithAuth(
        `/projects/${projectId}/images/${imageId}/status`,
        {
          method: "GET",
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to get processing status: ${response.status} - ${errorText}`
        );
      }

      const status: ImageProcessingStatus = await response.json();

      if (status.status === "completed" || status.status === "failed") {
        return status;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      attempts++;
    }

    throw new Error(
      "Image processing timeout - exceeded maximum polling attempts"
    );
  }

  async deleteProjectImage(projectId: number, s3Key: string): Promise<void> {
    const response = await this.fetchWithAuth(
      `/projects/${projectId}/images/${encodeURIComponent(s3Key)}`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to delete image: ${response.status} - ${errorText}`
      );
    }
  }

  async refreshPresignedUrl(
    projectId: number,
    s3Key: string
  ): Promise<{
    s3_key: string;
    url: string;
    expires_in: number;
  }> {
    const response = await this.fetchWithAuth(
      `/projects/${projectId}/images/${encodeURIComponent(s3Key)}/refresh-url`,
      {
        method: "POST",
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to refresh presigned URL: ${response.status} - ${errorText}`
      );
    }

    return response.json();
  }

  isAuthenticated(): boolean {
    return authService.isAuthenticated();
  }

  // ===== Automation & Screenshot Endpoints =====

  /**
   * List screenshots with filtering and pagination
   */
  async listScreenshots(params?: {
    project_id?: string;
    session_id?: string;
    source?: "manual" | "runner" | "api";
    page?: number;
    page_size?: number;
  }): Promise<unknown> {
    const queryParams = new URLSearchParams();
    if (params?.project_id) queryParams.append("project_id", params.project_id);
    if (params?.session_id) queryParams.append("session_id", params.session_id);
    if (params?.source) queryParams.append("source", params.source);
    if (params?.page) queryParams.append("page", params.page.toString());
    if (params?.page_size)
      queryParams.append("page_size", params.page_size.toString());

    const url = `/automation/screenshots${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error("Failed to list screenshots");
    }

    return response.json();
  }

  /**
   * Get a specific screenshot by ID
   */
  async getScreenshot(screenshotId: string): Promise<unknown> {
    const response = await this.fetchWithAuth(
      `/automation/screenshots/${screenshotId}`
    );

    if (!response.ok) {
      throw new Error("Failed to get screenshot");
    }

    return response.json();
  }

  /**
   * List automation sessions
   */
  async listAutomationSessions(params?: {
    project_id?: string;
    status?: "active" | "completed" | "failed" | "disconnected";
  }): Promise<{ sessions: AutomationSession[] }> {
    const queryParams = new URLSearchParams();
    if (params?.project_id) queryParams.append("project_id", params.project_id);
    if (params?.status) queryParams.append("status", params.status);

    const url = `/automation/sessions${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error("Failed to list automation sessions");
    }

    return response.json();
  }

  /**
   * Get a specific automation session with statistics
   */
  async getAutomationSession(sessionId: string): Promise<unknown> {
    const response = await this.fetchWithAuth(
      `/automation/sessions/${sessionId}`
    );

    if (!response.ok) {
      throw new Error("Failed to get automation session");
    }

    return response.json();
  }

  /**
   * List screenshots for a specific automation session
   */
  async listSessionScreenshots(
    sessionId: string,
    params?: { page?: number; page_size?: number }
  ): Promise<{ screenshots: Screenshot[] }> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append("page", params.page.toString());
    if (params?.page_size)
      queryParams.append("page_size", params.page_size.toString());

    const url = `/automation/sessions/${sessionId}/screenshots${
      queryParams.toString() ? `?${queryParams.toString()}` : ""
    }`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error("Failed to list session screenshots");
    }

    return response.json();
  }

  /**
   * List logs for a specific automation session
   */
  async listSessionLogs(
    sessionId: string,
    params?: { page?: number; page_size?: number }
  ): Promise<{ logs: AutomationLog[] }> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append("page", params.page.toString());
    if (params?.page_size)
      queryParams.append("page_size", params.page_size.toString());

    const url = `/automation/sessions/${sessionId}/logs${
      queryParams.toString() ? `?${queryParams.toString()}` : ""
    }`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error("Failed to list session logs");
    }

    return response.json();
  }

  /**
   * Get screenshot statistics
   */
  async getScreenshotStats(projectId?: string): Promise<unknown> {
    const queryParams = new URLSearchParams();
    if (projectId) queryParams.append("project_id", projectId);

    const url = `/automation/stats/screenshots${
      queryParams.toString() ? `?${queryParams.toString()}` : ""
    }`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error("Failed to get screenshot stats");
    }

    return response.json();
  }

  /**
   * Get automation session statistics
   */
  async getSessionStats(projectId?: string): Promise<unknown> {
    const queryParams = new URLSearchParams();
    if (projectId) queryParams.append("project_id", projectId);

    const url = `/automation/stats/sessions${
      queryParams.toString() ? `?${queryParams.toString()}` : ""
    }`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error("Failed to get session stats");
    }

    return response.json();
  }

  /**
   * Get a token for WebSocket authentication.
   * This fetches the JWT from the HttpOnly cookie via the ws-token endpoint.
   */
  // ===== Project Screenshot Endpoints =====

  /**
   * Upload a screenshot to a project using the new screenshots endpoint
   */
  async uploadProjectScreenshot(
    projectId: number,
    file: File,
    name: string,
    source:
      | "manual_upload"
      | "runner_capture"
      | "web_capture" = "manual_upload",
    monitorIndex?: number,
    onProgress?: (progress: number) => void
  ): Promise<{
    id: string;
    project_id: string;
    name: string;
    source: string;
    monitor_index?: number;
    metadata?: unknown;
    storage_path: string;
    presigned_url: string;
    thumbnail_url?: string;
    width: number;
    height: number;
    file_size: number;
    content_type: string;
    created_at: string;
    updated_at: string;
  }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("file", file);

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && onProgress) {
          const progress = (e.loaded / e.total) * 100;
          onProgress(progress);
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve(data);
          } catch (_error) {
            reject(new Error("Failed to parse upload response"));
          }
        } else {
          try {
            const errorData = JSON.parse(xhr.responseText);
            reject(new Error(errorData.detail || "Upload failed"));
          } catch {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      });

      xhr.addEventListener("error", () => {
        reject(new Error("Network error during upload"));
      });

      xhr.addEventListener("timeout", () => {
        reject(new Error("Upload timeout"));
      });

      // Build URL with query parameters
      const params = new URLSearchParams();
      params.append("name", name);
      params.append("source", source);
      if (monitorIndex !== undefined) {
        params.append("monitor_index", monitorIndex.toString());
      }

      xhr.open(
        "POST",
        `${API_BASE_URL}/api/v1/projects/${projectId}/screenshots/upload?${params.toString()}`
      );

      // HttpOnly Cookie Security: Enable credentials to send cookies
      xhr.withCredentials = true;

      const csrfToken = csrfService.getToken();
      if (csrfToken) {
        xhr.setRequestHeader("X-CSRF-Token", csrfToken);
      }

      xhr.timeout = 60000; // 60 seconds for file uploads
      xhr.send(formData);
    });
  }

  /**
   * List screenshots for a project
   */
  async listProjectScreenshots(
    projectId: string,
    options?: {
      source?: "manual_upload" | "runner_capture" | "web_capture";
      limit?: number;
      offset?: number;
    }
  ): Promise<{
    screenshots: Array<{
      id: string;
      project_id: string;
      name: string;
      source: string;
      monitor_index?: number;
      metadata?: unknown;
      storage_path: string;
      presigned_url: string;
      thumbnail_url?: string;
      width: number;
      height: number;
      file_size: number;
      content_type: string;
      created_at: string;
      updated_at: string;
    }>;
    total: number;
    limit: number;
    offset: number;
  }> {
    const queryParams = new URLSearchParams();
    if (options?.source) queryParams.append("source", options.source);
    if (options?.limit) queryParams.append("limit", options.limit.toString());
    if (options?.offset)
      queryParams.append("offset", options.offset.toString());

    const url = `/projects/${projectId}/screenshots${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(
        errorData.message || "Failed to list project screenshots"
      ) as Error & { code?: string; status?: number };
      error.code = errorData.error;
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  /**
   * Get a single screenshot by ID
   */
  async getProjectScreenshot(
    projectId: number,
    screenshotId: string
  ): Promise<{
    id: string;
    project_id: string;
    name: string;
    source: string;
    monitor_index?: number;
    metadata?: unknown;
    storage_path: string;
    presigned_url: string;
    thumbnail_url?: string;
    width: number;
    height: number;
    file_size: number;
    content_type: string;
    created_at: string;
    updated_at: string;
  }> {
    const response = await this.fetchWithAuth(
      `/projects/${projectId}/screenshots/${screenshotId}`
    );

    if (!response.ok) {
      throw new Error("Failed to get project screenshot");
    }

    return response.json();
  }

  /**
   * Update a screenshot's metadata
   */
  async updateProjectScreenshot(
    projectId: number,
    screenshotId: string,
    updates: {
      name?: string;
      source?: "manual_upload" | "runner_capture" | "web_capture";
      monitor_index?: number;
      metadata?: unknown;
    }
  ): Promise<{
    id: string;
    project_id: string;
    name: string;
    source: string;
    monitor_index?: number;
    metadata?: unknown;
    storage_path: string;
    presigned_url: string;
    thumbnail_url?: string;
    width: number;
    height: number;
    file_size: number;
    content_type: string;
    created_at: string;
    updated_at: string;
  }> {
    const response = await this.fetchWithAuth(
      `/projects/${projectId}/screenshots/${screenshotId}`,
      {
        method: "PATCH",
        body: JSON.stringify(updates),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to update project screenshot");
    }

    return response.json();
  }

  /**
   * Delete a screenshot
   */
  async deleteProjectScreenshot(
    projectId: number,
    screenshotId: string
  ): Promise<void> {
    const response = await this.fetchWithAuth(
      `/projects/${projectId}/screenshots/${screenshotId}`,
      {
        method: "DELETE",
      }
    );

    if (!response.ok) {
      throw new Error("Failed to delete project screenshot");
    }
  }

  /**
   * Batch delete multiple screenshots
   */
  async batchDeleteProjectScreenshots(
    projectId: number,
    screenshotIds: string[]
  ): Promise<{
    deleted_count: number;
    failed_ids: string[];
    errors: string[];
  }> {
    const response = await this.fetchWithAuth(
      `/projects/${projectId}/screenshots/batch-delete`,
      {
        method: "POST",
        body: JSON.stringify({ screenshot_ids: screenshotIds }),
      }
    );

    if (!response.ok) {
      throw new Error("Failed to batch delete project screenshots");
    }

    return response.json();
  }

  async getWebSocketToken(): Promise<string | null> {
    try {
      const response = await fetch("/api/v1/ws-token", {
        credentials: "include",
      });
      if (!response.ok) {
        console.error(
          "[ApiClient] Failed to get WebSocket token:",
          response.status
        );
        return null;
      }
      const data = await response.json();
      return data.token || null;
    } catch (error) {
      console.error("[ApiClient] Error getting WebSocket token:", error);
      return null;
    }
  }

  /**
   * Get WebSocket URL for real-time runner status updates (session start, logs, screenshots)
   */
  async getRunnerStatusWebSocketUrl(): Promise<string> {
    const wsProtocol = API_BASE_URL.startsWith("https") ? "wss" : "ws";
    const url = API_BASE_URL.replace(/^https?:\/\//, "");
    const baseUrl = `${wsProtocol}://${url}/api/v1/ws/runner/status`;

    // Get token for WebSocket authentication
    const token = await this.getWebSocketToken();
    if (token) {
      return `${baseUrl}?token=${encodeURIComponent(token)}`;
    }

    // Fallback without token (backend will try cookie auth)
    return baseUrl;
  }

  /**
   * Get WebSocket URL for monitoring a specific session
   */
  async getMonitorWebSocketUrl(sessionId: string): Promise<string> {
    const wsProtocol = API_BASE_URL.startsWith("https") ? "wss" : "ws";
    const url = API_BASE_URL.replace(/^https?:\/\//, "");
    const baseUrl = `${wsProtocol}://${url}/api/v1/automation/ws/automation/monitor/${sessionId}`;

    // Get token for WebSocket authentication
    const token = await this.getWebSocketToken();
    if (token) {
      return `${baseUrl}?token=${encodeURIComponent(token)}`;
    }

    // Fallback without token (backend will try cookie auth)
    return baseUrl;
  }

  // ===== Tree Events Endpoints =====

  /**
   * List tree events for an execution run
   */
  async listTreeEvents(
    runId: string,
    params?: {
      event_type?: string;
      node_type?: string;
      offset?: number;
      limit?: number;
    }
  ): Promise<{
    events: Array<{
      id: string;
      run_id: string;
      event_type: string;
      node_id: string;
      node_type: string;
      node_name: string;
      parent_node_id: string | null;
      path: Array<{ id: string; name: string; node_type: string }>;
      sequence: number;
      event_timestamp: number;
      status: string;
      error_message: string | null;
      metadata: Record<string, unknown> | null;
      created_at: string;
    }>;
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  }> {
    const queryParams = new URLSearchParams();
    if (params?.event_type) queryParams.append("event_type", params.event_type);
    if (params?.node_type) queryParams.append("node_type", params.node_type);
    if (params?.offset !== undefined)
      queryParams.append("offset", params.offset.toString());
    if (params?.limit !== undefined)
      queryParams.append("limit", params.limit.toString());

    const url = `/execution/runs/${runId}/tree-events${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to list tree events: ${response.status} - ${errorText}`
      );
    }

    return response.json();
  }

  // ===== Finding Category Endpoints =====

  async getFindingCategories(): Promise<FindingCategoryConfig[]> {
    const response = await this.fetchWithAuth("/finding-categories/");
    if (!response.ok) {
      throw new Error("Failed to get finding categories");
    }
    const data = await response.json();
    return data.items;
  }

  async createFindingCategory(
    data: FindingCategoryConfigCreate
  ): Promise<FindingCategoryConfig> {
    const response = await this.fetchWithAuth("/finding-categories/", {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Failed to create finding category");
    }
    return response.json();
  }

  async updateFindingCategory(
    id: string,
    data: FindingCategoryConfigUpdate
  ): Promise<FindingCategoryConfig> {
    const response = await this.fetchWithAuth(`/finding-categories/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Failed to update finding category");
    }
    return response.json();
  }

  async deleteFindingCategory(id: string): Promise<void> {
    const response = await this.fetchWithAuth(`/finding-categories/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Failed to delete finding category");
    }
  }

  async resetFindingCategories(): Promise<FindingCategoryConfig[]> {
    const response = await this.fetchWithAuth("/finding-categories/reset", {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error("Failed to reset finding categories");
    }
    const data = await response.json();
    return data.items;
  }

  // ===== Workflow Step Type Config Endpoints =====

  async getStepTypes(phase?: WorkflowPhase): Promise<StepTypeConfig[]> {
    const params = phase ? `?phase=${phase}` : "";
    const response = await this.fetchWithAuth(
      `/workflow-config/step-types${params}`
    );
    if (!response.ok) {
      throw new Error("Failed to get step types");
    }
    const data = await response.json();
    return data.items;
  }

  async createStepType(data: StepTypeConfigCreate): Promise<StepTypeConfig> {
    const response = await this.fetchWithAuth("/workflow-config/step-types", {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Failed to create step type");
    }
    return response.json();
  }

  async updateStepType(
    id: string,
    data: StepTypeConfigUpdate
  ): Promise<StepTypeConfig> {
    const response = await this.fetchWithAuth(
      `/workflow-config/step-types/${id}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      }
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Failed to update step type");
    }
    return response.json();
  }

  async deleteStepType(id: string): Promise<void> {
    const response = await this.fetchWithAuth(
      `/workflow-config/step-types/${id}`,
      {
        method: "DELETE",
      }
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Failed to delete step type");
    }
  }

  async resetStepTypes(): Promise<StepTypeConfig[]> {
    const response = await this.fetchWithAuth(
      "/workflow-config/step-types/reset",
      {
        method: "POST",
      }
    );
    if (!response.ok) {
      throw new Error("Failed to reset step types");
    }
    const data = await response.json();
    return data.items;
  }

  // ===== GUI Action Type Config Endpoints =====

  async getGuiActionTypes(): Promise<GuiActionTypeConfig[]> {
    const response = await this.fetchWithAuth(
      "/workflow-config/gui-action-types"
    );
    if (!response.ok) {
      throw new Error("Failed to get GUI action types");
    }
    const data = await response.json();
    return data.items;
  }

  async createGuiActionType(
    data: GuiActionTypeConfigCreate
  ): Promise<GuiActionTypeConfig> {
    const response = await this.fetchWithAuth(
      "/workflow-config/gui-action-types",
      {
        method: "POST",
        body: JSON.stringify(data),
      }
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Failed to create GUI action type");
    }
    return response.json();
  }

  async updateGuiActionType(
    id: string,
    data: GuiActionTypeConfigUpdate
  ): Promise<GuiActionTypeConfig> {
    const response = await this.fetchWithAuth(
      `/workflow-config/gui-action-types/${id}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
      }
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Failed to update GUI action type");
    }
    return response.json();
  }

  async deleteGuiActionType(id: string): Promise<void> {
    const response = await this.fetchWithAuth(
      `/workflow-config/gui-action-types/${id}`,
      {
        method: "DELETE",
      }
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Failed to delete GUI action type");
    }
  }

  async resetGuiActionTypes(): Promise<GuiActionTypeConfig[]> {
    const response = await this.fetchWithAuth(
      "/workflow-config/gui-action-types/reset",
      {
        method: "POST",
      }
    );
    if (!response.ok) {
      throw new Error("Failed to reset GUI action types");
    }
    const data = await response.json();
    return data.items;
  }

  // ===== Workflow Phase Config Endpoints =====

  async getWorkflowPhases(): Promise<WorkflowPhaseConfig[]> {
    const response = await this.fetchWithAuth("/workflow-config/phases");
    if (!response.ok) {
      throw new Error("Failed to get workflow phases");
    }
    const data = await response.json();
    return data.items;
  }

  async updateWorkflowPhase(
    id: string,
    data: WorkflowPhaseConfigUpdate
  ): Promise<WorkflowPhaseConfig> {
    const response = await this.fetchWithAuth(`/workflow-config/phases/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Failed to update workflow phase");
    }
    return response.json();
  }

  async resetWorkflowPhases(): Promise<WorkflowPhaseConfig[]> {
    const response = await this.fetchWithAuth("/workflow-config/phases/reset", {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error("Failed to reset workflow phases");
    }
    const data = await response.json();
    return data.items;
  }

  /**
   * Get the reconstructed execution tree for a run
   */
  async getExecutionTree(runId: string): Promise<{
    run_id: string;
    root_nodes: Array<{
      id: string;
      node_type: string;
      name: string;
      timestamp: number;
      end_timestamp?: number | null;
      duration?: number | null;
      status: string;
      metadata: Record<string, unknown>;
      error?: string | null;
      children: unknown[];
      is_expanded: boolean;
      level: number;
    }>;
    total_events: number;
    workflow_name: string | null;
    status: string;
    duration_ms: number | null;
    initial_state_ids: string[];
  }> {
    const response = await this.fetchWithAuth(`/execution/runs/${runId}/tree`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to get execution tree: ${response.status} - ${errorText}`
      );
    }

    return response.json();
  }
}

export const apiClient = new ApiClient();
