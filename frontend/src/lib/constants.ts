/**
 * Application-wide constants.
 *
 * Centralizes magic numbers and configuration values that are used across
 * multiple files. Constants that are only used in a single file should
 * remain local to that file.
 */

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

/** Timeout for XHR file uploads (ms). Used by api-client and file-upload-service. */
export const FILE_UPLOAD_TIMEOUT_MS = 60_000;

/** Default timeout for HTTP fetch requests (ms). */
export const HTTP_REQUEST_TIMEOUT_MS = 60_000;

/** Timeout for long-running model operations (ms). */
export const MODEL_OPERATION_TIMEOUT_MS = 600_000;

// ---------------------------------------------------------------------------
// Polling & Refresh Intervals
// ---------------------------------------------------------------------------

/** Default polling interval for data fetching (ms). */
export const DEFAULT_POLL_INTERVAL_MS = 1_000;

/** Polling interval for runner active connections (ms). */
export const ACTIVE_CONNECTIONS_POLL_INTERVAL_MS = 5_000;

/** Polling interval for runner health checks (ms). */
export const HEALTH_POLL_INTERVAL_MS = 10_000;

/** Refresh interval for dashboard auto-refresh (ms). */
export const DASHBOARD_REFRESH_INTERVAL_MS = 30_000;

/** Debounce delay for auto-save operations (ms). */
export const AUTO_SAVE_DEBOUNCE_MS = 2_000;

// ---------------------------------------------------------------------------
// WebSocket / Reconnection
// ---------------------------------------------------------------------------

/** Initial delay before first WebSocket reconnect attempt (ms). */
export const WS_INITIAL_RECONNECT_DELAY_MS = 1_000;

/** Maximum delay between WebSocket reconnect attempts (ms). */
export const WS_MAX_RECONNECT_DELAY_MS = 30_000;

/** Default maximum number of WebSocket reconnect attempts. */
export const WS_MAX_RECONNECT_ATTEMPTS = 10;

/** WebSocket normal closure code (RFC 6455). */
export const WS_NORMAL_CLOSURE_CODE = 1000;

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** Default page size for list views. */
export const DEFAULT_PAGE_SIZE = 20;

/** Default page size for activity feeds. */
export const ACTIVITY_FEED_PAGE_SIZE = 20;

/** Items per page for team member lists. */
export const TEAM_MEMBERS_PAGE_SIZE = 10;

/** Default limit for large data fetches (e.g., tree events). */
export const LARGE_FETCH_LIMIT = 500;

// ---------------------------------------------------------------------------
// Image Processing
// ---------------------------------------------------------------------------

/** Default image compression quality (0-100). */
export const DEFAULT_IMAGE_QUALITY = 85;

/** Threshold for formatting large counts (e.g., 1000 -> "1k"). */
export const LARGE_COUNT_THRESHOLD = 1_000;
