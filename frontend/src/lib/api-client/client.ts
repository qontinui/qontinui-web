/**
 * API Client
 *
 * HTTP client with authentication, retry logic, and token refresh.
 * Handles all communication with the backend API.
 */

import { createLogger } from "@/lib/logger";
import { authService, tokenManager } from "@/services/service-factory";
import { TokenValidator } from "@/services/auth/token-validator";
import { csrfService } from "@/services/csrf-service";

const logger = createLogger("ApiClient");
import type {
  User,
  Project,
  UserUpdate,
  ProjectCreate,
  ProjectUpdate,
} from "./types";
import type {
  AutomationSession,
  Screenshot,
  AutomationLog,
} from "@/types/automation";
import type {
  FindingCategoryConfig,
  FindingCategoryConfigCreate,
  FindingCategoryConfigUpdate,
  StepTypeConfig,
  StepTypeConfigCreate,
  StepTypeConfigUpdate,
  GuiActionTypeConfig,
  GuiActionTypeConfigCreate,
  GuiActionTypeConfigUpdate,
  WorkflowPhaseConfig,
  WorkflowPhaseConfigUpdate,
  WorkflowPhase,
  ImageUploadResponse,
  ImageProcessingStatus,
} from "./api-types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

/**
 * Build the `ws(s)://host` origin for a WebSocket URL.
 *
 * When API_BASE_URL is set (absolute, e.g. AWS staging) the WS origin is
 * derived from it. When it is empty (same-origin mode — REST is proxied
 * through Next.js) there is no absolute base to parse, so the WS origin is
 * derived from window.location instead.
 */
function getWebSocketOrigin(): string {
  if (API_BASE_URL) {
    const wsProtocol = API_BASE_URL.startsWith("https") ? "wss" : "ws";
    const host = API_BASE_URL.replace(/^https?:\/\//, "");
    return `${wsProtocol}://${host}`;
  }
  const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${wsProtocol}://${window.location.host}`;
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

  // ==========================================================================
  // Core HTTP
  // ==========================================================================

  private async fetchWithAuth(
    url: string,
    options: RequestInit = {},
    attempt = 1
  ): Promise<Response> {
    const requestId = crypto.randomUUID();
    const start = performance.now();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
      ...(options.headers as Record<string, string>),
    };

    // Token Refresh Strategy (Aligned with Backend):
    // - Backend sliding window middleware handles proactive token refresh (5min threshold)
    // - Frontend only refreshes reactively on 401 responses
    // - This prevents race conditions where both frontend and backend try to refresh simultaneously
    // - Backend sets new tokens via X-New-Access-Token and X-New-Refresh-Token headers
    //
    // Dual-mode auth (same as services/http-client.ts):
    // - Local: HttpOnly cookies carry the session.
    // - Remote (NEXT_PUBLIC_API_URL off-localhost): Bearer token is the only
    //   working path (cookies are not cross-origin deliverable). Token is
    //   restored from sessionStorage by TokenStorage's constructor when in
    //   ApiConfig.IS_REMOTE_BACKEND mode.
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
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          return this.fetchWithAuth(url, options, attempt + 1);
        }
      }

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter) : 60;

        if (attempt <= this.retryAttempts) {
          logger.warn(
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
        logger.warn(`Server error. Retrying in ${backoffTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffTime));
        return this.fetchWithAuth(url, options, attempt + 1);
      }

      const durationMs = Math.round(performance.now() - start);
      const method = options.method || "GET";
      if (durationMs > 1000) {
        logger.warn(
          `[API] SLOW ${method} ${url} ${response.status} ${durationMs}ms [${requestId}]`
        );
      } else if (process.env.NODE_ENV === "development") {
        logger.debug(
          `[API] ${method} ${url} ${response.status} ${durationMs}ms [${requestId}]`
        );
      }

      return response;
    } catch (error: unknown) {
      clearTimeout(timeoutId);

      const durationMs = Math.round(performance.now() - start);
      const method = options.method || "GET";
      logger.error(
        `[API] FAIL ${method} ${url} ${durationMs}ms [${requestId}]`,
        error
      );

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Request timeout");
      }

      if (!navigator.onLine) {
        throw new Error("No internet connection. Please check your network.");
      }

      throw error;
    }
  }

  // ==========================================================================
  // Auth
  // ==========================================================================

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

  isAuthenticated(): boolean {
    return authService.isAuthenticated();
  }

  // ==========================================================================
  // Projects
  // ==========================================================================

  async getProjects(): Promise<Project[]> {
    const response = await this.fetchWithAuth("/projects/");
    if (!response.ok) {
      const errorText = await response.text();
      logger.error("getProjects error:", response.status, errorText);
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

  // ==========================================================================
  // File Upload
  // ==========================================================================

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
      xhr.withCredentials = true;

      const csrfToken = csrfService.getToken();
      if (csrfToken) {
        xhr.setRequestHeader("X-CSRF-Token", csrfToken);
      }

      xhr.timeout = 60000;
      xhr.send(formData);
    });
  }

  // ==========================================================================
  // S3 Image Storage
  // ==========================================================================

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
      xhr.withCredentials = true;

      const csrfToken = csrfService.getToken();
      if (csrfToken) {
        xhr.setRequestHeader("X-CSRF-Token", csrfToken);
      }

      xhr.timeout = 60000;
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
      { method: "GET" }
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
    const pollInterval = 1000;

    while (attempts < maxAttempts) {
      const response = await this.fetchWithAuth(
        `/projects/${projectId}/images/${imageId}/status`,
        { method: "GET" }
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
      { method: "DELETE" }
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
      { method: "POST" }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to refresh presigned URL: ${response.status} - ${errorText}`
      );
    }

    return response.json();
  }

  // ==========================================================================
  // Automation & Screenshots
  // ==========================================================================

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

  async getScreenshot(screenshotId: string): Promise<unknown> {
    const response = await this.fetchWithAuth(
      `/automation/screenshots/${screenshotId}`
    );

    if (!response.ok) {
      throw new Error("Failed to get screenshot");
    }

    return response.json();
  }

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

  async getAutomationSession(sessionId: string): Promise<unknown> {
    const response = await this.fetchWithAuth(
      `/automation/sessions/${sessionId}`
    );

    if (!response.ok) {
      throw new Error("Failed to get automation session");
    }

    return response.json();
  }

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

  // ==========================================================================
  // Project Screenshots
  // ==========================================================================

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
      xhr.withCredentials = true;

      const csrfToken = csrfService.getToken();
      if (csrfToken) {
        xhr.setRequestHeader("X-CSRF-Token", csrfToken);
      }

      xhr.timeout = 60000;
      xhr.send(formData);
    });
  }

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

  async deleteProjectScreenshot(
    projectId: number,
    screenshotId: string
  ): Promise<void> {
    const response = await this.fetchWithAuth(
      `/projects/${projectId}/screenshots/${screenshotId}`,
      { method: "DELETE" }
    );

    if (!response.ok) {
      throw new Error("Failed to delete project screenshot");
    }
  }

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

  // ==========================================================================
  // WebSocket
  // ==========================================================================

  async getWebSocketToken(): Promise<string | null> {
    // Prefer the client-held Cognito bearer — hosted-UI sessions (the only
    // prod login flow) never set the HttpOnly `access_token` cookie, so the
    // cookie-reading route below 401s for them. The backend WS auth
    // (`get_current_user_from_ws`) verifies the same bearer the HTTP
    // `Authorization` header carries. Mirrors HttpClient.getWebSocketToken.
    const bearer = tokenManager.getAccessToken();
    if (bearer && !tokenManager.isAccessTokenExpired()) {
      return bearer;
    }

    try {
      const response = await fetch("/api/v1/ws-token", {
        credentials: "include",
      });
      if (!response.ok) {
        logger.error("Failed to get WebSocket token:", response.status);
        return null;
      }
      const data = await response.json();
      return data.token || null;
    } catch (error) {
      logger.error("Error getting WebSocket token:", error);
      return null;
    }
  }

  async getRunnerStatusWebSocketUrl(): Promise<string> {
    // Backend route is `/api/v1/runners/status` (runner_status_ws.py,
    // mounted unprefixed) — `/ws/runner/status` never existed.
    const baseUrl = `${getWebSocketOrigin()}/api/v1/runners/status`;

    const token = await this.getWebSocketToken();
    if (token) {
      return `${baseUrl}?token=${encodeURIComponent(token)}`;
    }

    return baseUrl;
  }

  async getMonitorWebSocketUrl(sessionId: string): Promise<string> {
    const baseUrl = `${getWebSocketOrigin()}/api/v1/automation/ws/automation/monitor/${sessionId}`;

    const token = await this.getWebSocketToken();
    if (token) {
      return `${baseUrl}?token=${encodeURIComponent(token)}`;
    }

    return baseUrl;
  }

  // ==========================================================================
  // Tree Events
  // ==========================================================================

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

  // ==========================================================================
  // Finding Categories
  // ==========================================================================

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

  // ==========================================================================
  // Workflow Step Type Config
  // ==========================================================================

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
      { method: "DELETE" }
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Failed to delete step type");
    }
  }

  async resetStepTypes(): Promise<StepTypeConfig[]> {
    const response = await this.fetchWithAuth(
      "/workflow-config/step-types/reset",
      { method: "POST" }
    );
    if (!response.ok) {
      throw new Error("Failed to reset step types");
    }
    const data = await response.json();
    return data.items;
  }

  // ==========================================================================
  // GUI Action Type Config
  // ==========================================================================

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
      { method: "DELETE" }
    );
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || "Failed to delete GUI action type");
    }
  }

  async resetGuiActionTypes(): Promise<GuiActionTypeConfig[]> {
    const response = await this.fetchWithAuth(
      "/workflow-config/gui-action-types/reset",
      { method: "POST" }
    );
    if (!response.ok) {
      throw new Error("Failed to reset GUI action types");
    }
    const data = await response.json();
    return data.items;
  }

  // ==========================================================================
  // Workflow Phase Config
  // ==========================================================================

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

  // ==========================================================================
  // Execution Tree
  // ==========================================================================

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
