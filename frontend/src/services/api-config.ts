export class ApiConfig {
  // Main API (authentication, users, projects)
  // Use environment variable to call backend directly (required for cookie-based auth)
  // Next.js rewrites don't forward cookies, so direct calls are needed
  static readonly API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

  /**
   * True when API_BASE_URL points at a non-localhost host (e.g. staging /
   * production on AWS). Switches the frontend into Bearer-only auth mode:
   * the access token from the login response is held client-side (memory +
   * sessionStorage) and sent as Authorization: Bearer on every request via
   * HttpClient.
   *
   * The HttpOnly-cookie path remains the local-dev default because browsers
   * refuse to attach cross-origin cookies set on a different domain
   * (cookies on *.qontinui.io don't ride along on requests from
   * http://localhost:3001). This flag controls sessionStorage persistence
   * of the Bearer token (so login survives page reloads even without a
   * cookie fallback).
   */
  // Empty API_BASE_URL means same-origin (requests go through the Next.js
  // proxy on the same host), so HttpOnly cookies ride along normally — that
  // is NOT a remote/cross-origin backend.
  static readonly IS_REMOTE_BACKEND =
    !!process.env.NEXT_PUBLIC_API_URL &&
    !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(
      `${process.env.NEXT_PUBLIC_API_URL}/`
    );

  // Runner URL for local automation (pattern matching, state discovery, extraction)
  // The runner provides a unified API that calls the qontinui library via IPC
  // Use 127.0.0.1 instead of localhost to force IPv4 (runner only listens on IPv4)
  static readonly RUNNER_URL =
    process.env.NEXT_PUBLIC_RUNNER_URL || "http://127.0.0.1:9876";

  // Current-user endpoint. Authentication is Cognito-only: the access token
  // minted by the hosted-UI flow is attached as `Authorization: Bearer` and the
  // backend dual-accepts Cognito JWTs. There are no local jwt/login, register,
  // jwt/logout, or jwt/refresh routes — sign-in / sign-up / password-reset /
  // sign-out all happen in the Cognito hosted UI.
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
