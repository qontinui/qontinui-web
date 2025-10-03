import { TokenManager } from './token-manager';

export interface HttpOptions extends RequestInit {
  skipAuth?: boolean;
  maxRetries?: number;
}

export class HttpClient {
  private tokenManager: TokenManager;
  private csrfToken: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;
  private onSessionExpired?: () => void;

  constructor(tokenManager: TokenManager) {
    this.tokenManager = tokenManager;
    this.initializeCSRF();
  }

  private initializeCSRF(): void {
    if (typeof window === 'undefined') return;

    try {
      const metaTag = document.querySelector('meta[name="csrf-token"]');
      if (metaTag) {
        this.csrfToken = metaTag.getAttribute('content');
      } else {
        const match = document.cookie.match(/csrf_token=([^;]+)/);
        if (match) {
          this.csrfToken = match[1];
        }
      }
    } catch (error) {
      console.warn('CSRF token not found');
    }
  }

  setSessionExpiredHandler(handler: () => void): void {
    this.onSessionExpired = handler;
  }

  async fetch(url: string, options: HttpOptions = {}): Promise<Response> {
    const { skipAuth = false, maxRetries = 3, ...fetchOptions } = options;
    return this.fetchWithRetry(url, fetchOptions, skipAuth, 1, maxRetries);
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    skipAuth: boolean,
    attempt: number,
    maxRetries: number
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (!skipAuth) {
      const accessToken = this.tokenManager.getAccessToken();
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
    }

    if (this.csrfToken && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method || 'GET')) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle 401 Unauthorized
      if (response.status === 401 && !skipAuth && attempt === 1) {
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          return this.fetchWithRetry(url, options, skipAuth, attempt + 1, maxRetries);
        } else if (this.onSessionExpired) {
          this.onSessionExpired();
        }
      }

      // Handle rate limiting
      if (response.status === 429 && attempt <= maxRetries) {
        const retryAfter = response.headers.get('Retry-After');
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter) : 60;

        console.warn(`Rate limited. Retrying after ${retryAfterSeconds} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
        return this.fetchWithRetry(url, options, skipAuth, attempt + 1, maxRetries);
      }

      // Handle server errors with retry
      if (response.status >= 500 && attempt <= maxRetries) {
        const backoffTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.warn(`Server error. Retrying in ${backoffTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffTime));
        return this.fetchWithRetry(url, options, skipAuth, attempt + 1, maxRetries);
      }

      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error('No internet connection. Please check your network.');
      }

      throw error;
    }
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefreshToken();
    const result = await this.refreshPromise;
    this.refreshPromise = null;
    return result;
  }

  private async doRefreshToken(): Promise<boolean> {
    const refreshToken = this.tokenManager.getRefreshToken();
    if (!refreshToken) return false;

    try {
      const response = await fetch('/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (response.ok) {
        const tokens = await response.json();
        this.tokenManager.setTokens(tokens);
        return true;
      }
    } catch (error) {
      console.error('Failed to refresh token:', error);
    }

    this.tokenManager.clearTokens();
    return false;
  }
}
