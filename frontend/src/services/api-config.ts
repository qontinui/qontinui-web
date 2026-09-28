import { resolveEndpoint } from "@/lib/errors/endpoint-unresolved";

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

  // There is deliberately no runner base URL here: runner calls name a target
  // and resolve their transport per request (`runnerRequest` in
  // `@/lib/runner`) — loopback only for a runner proven local, the backend
  // relay otherwise.

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
   * The ABSOLUTE backend base URL, for a consumer outside this page that cannot
   * use a same-origin relative path — e.g. the `backend_url` handed to the
   * runner so it can post extraction results back.
   *
   * - `NEXT_PUBLIC_API_URL` set: that.
   * - Unset (the supported same-origin configuration) IN THE BROWSER: this
   *   page's own origin. `next.config.mjs`'s `fallback` rewrite
   *   `/api/:path*` → `${BACKEND_URL}/api/:path*` proxies every `/api/v1/*`
   *   path that has no route handler — which covers the runner's
   *   `/api/v1/extractions/*` writes — and forwards the `Authorization`
   *   header the runner sends, so the origin IS a working backend base.
   * - Unset on the server (no origin to derive): `resolveEndpoint`'s rule —
   *   the dev default in development, otherwise `EndpointUnresolvedError`
   *   naming the variable to set. Never a dev-stack address in production.
   */
  static resolveAbsoluteBaseUrl(): string {
    const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
    if (
      !configured &&
      typeof window !== "undefined" &&
      window.location?.origin &&
      window.location.origin !== "null"
    ) {
      return window.location.origin;
    }
    return resolveEndpoint("api", configured);
  }

  /**
   * The WebSocket base for backend streams: `NEXT_PUBLIC_WS_URL` when set,
   * otherwise derived from {@link resolveAbsoluteBaseUrl} (http→ws,
   * https→wss) — the same same-origin derivation `useChatWebSocket` uses.
   * Throws `EndpointUnresolvedError` where that does.
   */
  static resolveWebSocketBaseUrl(): string {
    const configured = process.env.NEXT_PUBLIC_WS_URL?.trim();
    const base = configured || ApiConfig.resolveAbsoluteBaseUrl();
    return base.replace(/\/+$/, "").replace(/^http(s?):\/\//, "ws$1://");
  }

  /**
   * Alias for getBaseUrl() - returns the API URL
   * @deprecated Use getBaseUrl() instead
   */
  static getApiUrl(): string {
    return ApiConfig.API_BASE_URL;
  }
}
