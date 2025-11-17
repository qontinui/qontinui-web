import { authService } from '@/services/service-factory';
import { TokenValidator } from '@/services/auth/token-validator';
import { csrfService } from '@/services/csrf-service';
import type {
  User,
  Project,
  UserUpdate,
  ProjectCreate,
  ProjectUpdate
} from '@/lib/api-client/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

// Re-export types for backwards compatibility
export type { User, Project, UserUpdate, ProjectCreate, ProjectUpdate };

// Image types
export interface ImageUploadResponse {
  image_id: string;
  variants: {
    original: string;
    thumb: string;
    medium: string;
    large: string;
  };
  presigned_urls: {
    original: string;
    thumb: string;
    medium: string;
    large: string;
  };
  status: 'processing' | 'completed';
  job_id?: string;
  // Legacy fields for backward compatibility
  s3_key?: string;
  url?: string;
  size?: number;
  created_at?: string;
}

export interface ImageProcessingStatus {
  status: 'processing' | 'completed' | 'failed';
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
  private tokenValidator: TokenValidator;
  private retryAttempts = 3;

  constructor() {
    this.tokenValidator = new TokenValidator();
  }

  private async fetchWithAuth(url: string, options: RequestInit = {}, attempt = 1): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
    };

    // Token Refresh Strategy (Aligned with Backend):
    // - Backend sliding window middleware handles proactive token refresh (5min threshold)
    // - Frontend only refreshes reactively on 401 responses
    // - This prevents race conditions where both frontend and backend try to refresh simultaneously
    // - Backend sets new tokens via X-New-Access-Token and X-New-Refresh-Token headers
    //
    // HttpOnly Cookie Security:
    // - Tokens are stored in HttpOnly cookies (XSS protection)
    // - Browser automatically sends cookies with credentials: 'include'
    // - No Authorization header needed
    console.debug('[ApiClient] Using HttpOnly cookie authentication');

    // Add CSRF token for state-changing requests
    const csrfToken = csrfService.getToken();
    if (csrfToken && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method || 'GET')) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    // Add timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1${url}`, {
        ...options,
        headers,
        credentials: 'include',
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
        const retryAfter = response.headers.get('Retry-After');
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter) : 60;

        if (attempt <= this.retryAttempts) {
          console.warn(`Rate limited. Retrying after ${retryAfterSeconds} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryAfterSeconds * 1000));
          return this.fetchWithAuth(url, options, attempt + 1);
        }

        throw new Error('Rate limit exceeded. Please try again later.');
      }

      // Handle server errors with retry
      if (response.status >= 500 && attempt <= this.retryAttempts) {
        const backoffTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.warn(`Server error. Retrying in ${backoffTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
        return this.fetchWithAuth(url, options, attempt + 1);
      }

      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }

      // Check for network errors
      if (!navigator.onLine) {
        throw new Error('No internet connection. Please check your network.');
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
    return authService.getCurrentUser();
  }

  async updateCurrentUser(data: UserUpdate): Promise<User> {
    const response = await this.fetchWithAuth('/users/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error('Failed to update user');
    }
    return response.json();
  }

  // Project endpoints
  async getProjects(): Promise<Project[]> {
    const response = await this.fetchWithAuth('/projects/');
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ApiClient] getProjects error:', response.status, errorText);
      throw new Error(`Failed to get projects: ${response.status} - ${errorText}`);
    }
    return response.json();
  }

  async getProject(id: number): Promise<Project> {
    const response = await this.fetchWithAuth(`/projects/${id}`);
    if (!response.ok) {
      throw new Error('Failed to get project');
    }
    return response.json();
  }

  async createProject(data: ProjectCreate): Promise<Project> {
    const response = await this.fetchWithAuth('/projects/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error('Failed to create project');
    }
    return response.json();
  }

  async updateProject(id: number, data: ProjectUpdate): Promise<Project> {
    const response = await this.fetchWithAuth(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error('Failed to update project');
    }
    return response.json();
  }

  async deleteProject(id: number): Promise<void> {
    const response = await this.fetchWithAuth(`/projects/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete project');
    }
  }

  // File upload with progress
  async uploadFile(url: string, file: File, onProgress?: (progress: number) => void): Promise<any> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('file', file);

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const progress = (e.loaded / e.total) * 100;
          onProgress(progress);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve(data);
          } catch {
            resolve(xhr.responseText);
          }
        } else {
          reject(new Error('Upload failed'));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload'));
      });

      xhr.addEventListener('timeout', () => {
        reject(new Error('Upload timeout'));
      });

      xhr.open('POST', `${API_BASE_URL}/api/v1${url}`);

      // HttpOnly Cookie Security: Enable credentials to send cookies
      xhr.withCredentials = true;

      const csrfToken = csrfService.getToken();
      if (csrfToken) {
        xhr.setRequestHeader('X-CSRF-Token', csrfToken);
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
      formData.append('file', file);

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const progress = (e.loaded / e.total) * 100;
          onProgress(progress);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve(data);
          } catch (error) {
            reject(new Error('Failed to parse upload response'));
          }
        } else {
          try {
            const errorData = JSON.parse(xhr.responseText);
            reject(new Error(errorData.detail || 'Upload failed'));
          } catch {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload'));
      });

      xhr.addEventListener('timeout', () => {
        reject(new Error('Upload timeout'));
      });

      xhr.open('POST', `${API_BASE_URL}/api/v1/images/projects/${projectId}/images/upload`);

      // HttpOnly Cookie Security: Enable credentials to send cookies
      xhr.withCredentials = true;

      const csrfToken = csrfService.getToken();
      if (csrfToken) {
        xhr.setRequestHeader('X-CSRF-Token', csrfToken);
      }

      xhr.timeout = 60000; // 60 seconds for file uploads
      xhr.send(formData);
    });
  }

  async getImageUrl(
    projectId: string,
    imageId: string,
    size: 'thumb' | 'medium' | 'large' | 'original' = 'medium'
  ): Promise<string> {
    const response = await this.fetchWithAuth(
      `/images/projects/${projectId}/images/${imageId}/url?size=${size}`,
      {
        method: 'GET',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get image URL: ${response.status} - ${errorText}`);
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
        `/images/projects/${projectId}/images/${imageId}/status`,
        {
          method: 'GET',
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get processing status: ${response.status} - ${errorText}`);
      }

      const status: ImageProcessingStatus = await response.json();

      if (status.status === 'completed' || status.status === 'failed') {
        return status;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      attempts++;
    }

    throw new Error('Image processing timeout - exceeded maximum polling attempts');
  }

  async deleteProjectImage(projectId: number, s3Key: string): Promise<void> {
    const response = await this.fetchWithAuth(
      `/images/projects/${projectId}/images/${encodeURIComponent(s3Key)}`,
      {
        method: 'DELETE',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete image: ${response.status} - ${errorText}`);
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
      `/images/projects/${projectId}/images/${encodeURIComponent(s3Key)}/refresh-url`,
      {
        method: 'POST',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to refresh presigned URL: ${response.status} - ${errorText}`);
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
    source?: 'manual' | 'runner' | 'api';
    page?: number;
    page_size?: number;
  }): Promise<any> {
    const queryParams = new URLSearchParams();
    if (params?.project_id) queryParams.append('project_id', params.project_id);
    if (params?.session_id) queryParams.append('session_id', params.session_id);
    if (params?.source) queryParams.append('source', params.source);
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.page_size) queryParams.append('page_size', params.page_size.toString());

    const url = `/automation/screenshots${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error('Failed to list screenshots');
    }

    return response.json();
  }

  /**
   * Get a specific screenshot by ID
   */
  async getScreenshot(screenshotId: string): Promise<any> {
    const response = await this.fetchWithAuth(`/automation/screenshots/${screenshotId}`);

    if (!response.ok) {
      throw new Error('Failed to get screenshot');
    }

    return response.json();
  }

  /**
   * List automation sessions
   */
  async listAutomationSessions(params?: {
    project_id?: string;
    status?: 'active' | 'completed' | 'failed' | 'disconnected';
  }): Promise<any[]> {
    const queryParams = new URLSearchParams();
    if (params?.project_id) queryParams.append('project_id', params.project_id);
    if (params?.status) queryParams.append('status', params.status);

    const url = `/automation/sessions${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error('Failed to list automation sessions');
    }

    return response.json();
  }

  /**
   * Get a specific automation session with statistics
   */
  async getAutomationSession(sessionId: string): Promise<any> {
    const response = await this.fetchWithAuth(`/automation/sessions/${sessionId}`);

    if (!response.ok) {
      throw new Error('Failed to get automation session');
    }

    return response.json();
  }

  /**
   * List screenshots for a specific automation session
   */
  async listSessionScreenshots(
    sessionId: string,
    params?: { page?: number; page_size?: number }
  ): Promise<any> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.page_size) queryParams.append('page_size', params.page_size.toString());

    const url = `/automation/sessions/${sessionId}/screenshots${
      queryParams.toString() ? `?${queryParams.toString()}` : ''
    }`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error('Failed to list session screenshots');
    }

    return response.json();
  }

  /**
   * List logs for a specific automation session
   */
  async listSessionLogs(
    sessionId: string,
    params?: { page?: number; page_size?: number }
  ): Promise<any> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.page_size) queryParams.append('page_size', params.page_size.toString());

    const url = `/automation/sessions/${sessionId}/logs${
      queryParams.toString() ? `?${queryParams.toString()}` : ''
    }`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error('Failed to list session logs');
    }

    return response.json();
  }

  /**
   * Get screenshot statistics
   */
  async getScreenshotStats(projectId?: string): Promise<any> {
    const queryParams = new URLSearchParams();
    if (projectId) queryParams.append('project_id', projectId);

    const url = `/automation/stats/screenshots${
      queryParams.toString() ? `?${queryParams.toString()}` : ''
    }`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error('Failed to get screenshot stats');
    }

    return response.json();
  }

  /**
   * Get automation session statistics
   */
  async getSessionStats(projectId?: string): Promise<any> {
    const queryParams = new URLSearchParams();
    if (projectId) queryParams.append('project_id', projectId);

    const url = `/automation/stats/sessions${
      queryParams.toString() ? `?${queryParams.toString()}` : ''
    }`;
    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new Error('Failed to get session stats');
    }

    return response.json();
  }

  /**
   * Get WebSocket URL for runner connection
   */
  getRunnerWebSocketUrl(): string {
    const wsProtocol = API_BASE_URL.startsWith('https') ? 'wss' : 'ws';
    const url = API_BASE_URL.replace(/^https?:\/\//, '');
    return `${wsProtocol}://${url}/api/v1/ws/automation/runner`;
  }
}

export const apiClient = new ApiClient();
