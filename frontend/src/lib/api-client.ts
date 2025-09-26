const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

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

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
  full_name?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private csrfToken: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;
  private sessionTimeoutWarning: NodeJS.Timeout | null = null;
  private sessionTimeout: NodeJS.Timeout | null = null;
  private retryAttempts = 3;
  private onSessionExpired?: () => void;

  constructor() {
    // Load tokens from localStorage if available
    if (typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem('access_token');
      this.refreshToken = localStorage.getItem('refresh_token');
      this.initializeCSRF();
      this.startSessionTimer();
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

  private setTokens(tokens: TokenResponse) {
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('access_token', tokens.access_token);
      localStorage.setItem('refresh_token', tokens.refresh_token);
      this.startSessionTimer();
    }
  }

  private clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      this.clearSessionTimers();
    }
  }

  private startSessionTimer() {
    this.clearSessionTimers();

    // Warning after 12 minutes (3 minutes before expiry)
    this.sessionTimeoutWarning = setTimeout(() => {
      if (this.onSessionExpired) {
        console.warn('Session will expire in 3 minutes');
        // Trigger a warning UI notification
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('session-expiring', {
            detail: { minutesRemaining: 3 }
          }));
        }
      }
    }, 12 * 60 * 1000);

    // Auto-refresh or logout after 14 minutes
    this.sessionTimeout = setTimeout(async () => {
      const refreshed = await this.refreshAccessToken();
      if (!refreshed && this.onSessionExpired) {
        this.onSessionExpired();
      }
    }, 14 * 60 * 1000);
  }

  private clearSessionTimers() {
    if (this.sessionTimeoutWarning) {
      clearTimeout(this.sessionTimeoutWarning);
      this.sessionTimeoutWarning = null;
    }
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
  }

  public setSessionExpiredHandler(handler: () => void) {
    this.onSessionExpired = handler;
  }

  private async fetchWithAuth(url: string, options: RequestInit = {}, attempt = 1): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers as Record<string, string>,
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    // Add CSRF token for state-changing requests
    if (this.csrfToken && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method || 'GET')) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }

    // Add timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(`${API_BASE_URL}${url}`, {
        ...options,
        headers,
        credentials: 'include',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 401 Unauthorized
      if (response.status === 401 && this.refreshToken && attempt === 1) {
        // Try to refresh the token
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          // Retry the original request with new token
          return this.fetchWithAuth(url, options, attempt + 1);
        } else if (this.onSessionExpired) {
          this.onSessionExpired();
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

    this.refreshPromise = this.doRefreshToken();
    const result = await this.refreshPromise;
    this.refreshPromise = null;
    return result;
  }

  private async doRefreshToken(): Promise<boolean> {
    if (!this.refreshToken) return false;

    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      });

      if (response.ok) {
        const tokens: TokenResponse = await response.json();
        this.setTokens(tokens);
        return true;
      }
    } catch (error) {
      console.error('Failed to refresh token:', error);
    }

    this.clearTokens();
    return false;
  }

  // Auth endpoints
  async login(credentials: LoginRequest): Promise<User> {
    const formData = new URLSearchParams();
    formData.append('username', credentials.username);
    formData.append('password', credentials.password);

    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Login failed');
    }

    const tokens: TokenResponse = await response.json();
    this.setTokens(tokens);

    // Get user info after login
    return this.getCurrentUser();
  }

  async register(data: RegisterRequest): Promise<User> {
    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Registration failed');
    }

    return response.json();
  }

  async logout() {
    try {
      // Call logout endpoint to blacklist the token
      if (this.accessToken) {
        await this.fetchWithAuth('/auth/logout', {
          method: 'POST',
        });
      }
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      this.clearTokens();
    }
  }

  // User endpoints
  async getCurrentUser(): Promise<User> {
    const response = await this.fetchWithAuth('/users/me');
    if (!response.ok) {
      throw new Error('Failed to get user info');
    }
    return response.json();
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
      throw new Error('Failed to get projects');
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

      xhr.open('POST', `${API_BASE_URL}${url}`);

      if (this.accessToken) {
        xhr.setRequestHeader('Authorization', `Bearer ${this.accessToken}`);
      }

      if (this.csrfToken) {
        xhr.setRequestHeader('X-CSRF-Token', this.csrfToken);
      }

      xhr.timeout = 60000; // 60 seconds for file uploads
      xhr.send(formData);
    });
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }
}

export const apiClient = new ApiClient();
