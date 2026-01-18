export class ApiConfig {
  // Main API (authentication, users, projects)
  // Use empty string to make relative URLs that go through Next.js proxy
  static readonly API_BASE_URL = "";

  // Runner URL for local automation (pattern matching, state discovery, extraction)
  // The runner provides a unified API that calls the qontinui library via IPC
  static readonly RUNNER_URL =
    process.env.NEXT_PUBLIC_RUNNER_URL || "http://localhost:9876";

  // Auth endpoints (fastapi-users JWT routes)
  static readonly AUTH_LOGIN = `${ApiConfig.API_BASE_URL}/api/v1/auth/jwt/login`;
  static readonly AUTH_REGISTER = `${ApiConfig.API_BASE_URL}/api/v1/auth/register`;
  static readonly AUTH_LOGOUT = `${ApiConfig.API_BASE_URL}/api/v1/auth/jwt/logout`;
  static readonly AUTH_REFRESH = `${ApiConfig.API_BASE_URL}/api/v1/auth/jwt/refresh`;
  static readonly USERS_ME = `${ApiConfig.API_BASE_URL}/api/v1/auth/users/me`;

  /**
   * Get the base URL for API requests
   * Returns empty string for relative URLs (uses Next.js proxy)
   */
  static getBaseUrl(): string {
    return ApiConfig.API_BASE_URL;
  }

  /**
   * Get the runner URL for local automation
   * The runner provides pattern matching, extraction, and automation via qontinui library
   */
  static getRunnerUrl(): string {
    return ApiConfig.RUNNER_URL;
  }

  /**
   * Alias for getBaseUrl() - returns the API URL
   * @deprecated Use getBaseUrl() instead
   */
  static getApiUrl(): string {
    return ApiConfig.API_BASE_URL;
  }
}
