import { authService } from '@/services/service-factory';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

export interface User {
  id: number;
  email: string;
  username: string;
  full_name?: string;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: number;
  name: string;
  description?: string;
  configuration: any;
  owner_id: number;
  created_at: string;
  updated_at: string;
}

class ApiClient {
  private csrfToken: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;
  private retryAttempts = 3;

  constructor() {
    if (typeof window !== 'undefined') {
      this.initializeCSRF();
    }
  }

  private async initializeCSRF() {
    try {
      // Get CSRF token from meta tag or cookie
      const metaTag = document.querySelector('meta[name="csrf-token"]');
      if (metaTag) {
        this.csrfToken = metaTag.getAttribute('content');
      } else {
        // Try to get from cookie
        const match = document.cookie.match(/csrf_token=([^;]+)/);
        if (match) {
          this.csrfToken = match[1];
        }
      }
    } catch (error) {
      console.warn('CSRF token not found');
    }
  }

  private async fetchWithAuth(url: string, options: RequestInit = {}, attempt = 1): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
    };

    const accessToken = authService.isAuthenticated() ? authService.tokenManager.getAccessToken() : null;

    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    // Add CSRF token for state-changing requests
    if (this.csrfToken && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method || 'GET')) {
      headers['X-CSRF-Token'] = this.csrfToken;
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
    // Prevent multiple simultaneous refresh attempts
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = authService.refreshAccessToken();
    const result = await this.refreshPromise;
    this.refreshPromise = null;
    return result;
  }

  async logout() {
    return authService.logout();
  }

  async getCurrentUser(): Promise<User> {
    return authService.getCurrentUser();
  }

  async updateCurrentUser(data: Partial<User>): Promise<User> {
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

  async createProject(data: { name: string; description?: string; configuration: any }): Promise<Project> {
    const response = await this.fetchWithAuth('/projects/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error('Failed to create project');
    }
    return response.json();
  }

  async updateProject(id: number, data: Partial<Project>): Promise<Project> {
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

      const accessToken = authService.isAuthenticated() ? authService.tokenManager.getAccessToken() : null;
      if (accessToken) {
        xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      }

      if (this.csrfToken) {
        xhr.setRequestHeader('X-CSRF-Token', this.csrfToken);
      }

      xhr.timeout = 60000; // 60 seconds for file uploads
      xhr.send(formData);
    });
  }

  isAuthenticated(): boolean {
    return authService.isAuthenticated();
  }
}

export const apiClient = new ApiClient();
