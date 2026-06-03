/**
 * Ξ_ClientTelemetry — client event types (plan §3.1).
 *
 * Plan: D:/qontinui-root/plans/2026-05-31-twin-client-telemetry-layer.md
 *
 * One structured, PRE-SCRUBBED event per client incident. These are real
 * users' browsers, so every field here is allowlisted (§3.2): we ship only
 * what is diagnostic-bearing AND non-identifying. NEVER cookies, localStorage,
 * form values, request/response bodies, secret values, or raw URLs.
 *
 * NOTE: ``ingest_ts`` (the server receive clock, §3.1) is SERVER-ONLY and is
 * therefore intentionally absent from the client event type — the client only
 * controls ``client_ts``.
 */

/** The incident kind (plan §3.1 ``kind`` enum). */
export type ClientTelemetryKind =
  | "console_error"
  | "unhandled_rejection"
  | "window_error"
  | "fetch_failure"
  | "cors_failure"
  | "csp_violation"
  | "auth_callback_failure"
  | "resource_error"
  | "hydration_error";

/** The network failure classification (plan §3.1 ``failure_class`` enum). */
export type ClientTelemetryFailureClass =
  | "cors"
  | "network"
  | "dns"
  | "timeout"
  | "http_4xx"
  | "http_5xx"
  | "opaque";

/**
 * A single stack frame — SYMBOL name + ``file:line`` only (plan §3.2). NEVER
 * raw eval/inline source content. Symbolication to source-map names happens
 * server-side; the client ships whatever the runtime exposed (already just
 * symbol + location).
 */
export interface ClientTelemetryFrame {
  /** Resolved symbol name, e.g. ``getCurrentUser`` / ``fetch``. */
  symbol: string;
  /** Bundle file the frame lives in (host stripped to a bundle-relative hint). */
  file?: string;
  /** 1-based line number, when available. */
  line?: number;
  /** 1-based column number, when available. */
  column?: number;
}

/**
 * The pre-scrubbed client telemetry event (plan §3.1). Built on the client,
 * scrubbed on the client (§3.2 first pass), and re-scrubbed authoritatively at
 * ingest (§3.2 — never trust the client).
 */
export interface ClientTelemetryEvent {
  /** Client-generated UUID, for idempotent dedup. */
  event_id: string;
  /** Browser clock (untrusted) — ISO 8601. */
  client_ts: string;
  /** The incident kind. */
  kind: ClientTelemetryKind;
  /**
   * ★ Bundle build-id / git SHA / deploy SHA — ties the event to a deploy.
   * The spine that makes the continuous post-deploy gate (§4.3) possible.
   */
  release: string;
  /** The surface — ``web`` in v1; forward-compat enum (plan §7 Q7). */
  surface: "web" | "mobile_webview";
  /** ★ The page origin the bundle is running ON, e.g. ``https://qontinui.io``. */
  origin: string;
  /** Route pattern, NOT a raw path (``/users/:id`` not ``/users/jspinak@…``). */
  route_template: string;

  // --- fetch / cors / csp specifics ---
  /**
   * ★★ The host the bundle tried to call — THE worked-example field
   * (``web.staging.qontinui.io``). Host only; never the full URL.
   */
  request_host?: string;
  /** Path TEMPLATE only — query + fragment + path-params stripped. */
  request_path_tmpl?: string;
  /** The network failure classification. */
  failure_class?: ClientTelemetryFailureClass;
  /** HTTP status, when available. */
  http_status?: number;

  // --- error specifics (all scrubbed) ---
  /** The error class/name, e.g. ``TypeError``. */
  error_name: string;
  /**
   * Normalized error template — the raw free-text message body is DROPPED
   * (§3.2 allowlist-not-denylist); this is a class/shape token only, never the
   * raw message.
   */
  error_message_norm: string;
  /** Top N frames — symbol names + ``file:line`` only (§3.2). */
  stack_top: ClientTelemetryFrame[];

  // --- blast-radius / dedup (never identity) ---
  /** Coarse browser family (Chrome/Safari/…) — blast-radius, not fingerprinting. */
  browser_family: string;
  /**
   * EPHEMERAL in-memory per-page-load, salted, non-reversible — distinct-session
   * count only. NEVER persisted to device storage (keeps it out of ePrivacy
   * "storage/access" consent scope — plan §3.6). See ``session-hash.ts``.
   */
  session_hash: string;
  /** Client-side dedup / sampling weight. */
  count: number;
  /**
   * GPC/DNT honored: when ``true`` the event is dropped at source and never
   * transmitted (plan §3.6 legitimate-interest + opt-out). Present on the type
   * for completeness; in practice an opted-out event is never sent.
   */
  opt_out: boolean;
}

/**
 * The §3.3 READ CONTRACT — ``WindowedAggregate``.
 *
 * This is the shape the coord Ξ_ClientTelemetry observer reads downstream: the
 * windowed rollup of client events keyed by
 * ``(release, origin, route_template, kind, request_host)`` over 1m/5m/1h
 * buckets (plan §3.3). It documents the contract the observer evaluates Φ_*
 * against.
 *
 * IMPORTANT (plan §3.5 buy-vs-build): coord queries the BOUGHT telemetry
 * backend's aggregate API — it does NOT query this TS type directly, and this
 * frontend does NOT author the ingest/aggregation. This type is the documented
 * contract the bought backend's aggregate must satisfy (the adapter maps the
 * vendor's response into this shape), so the read side stays vendor-agnostic.
 */
export interface WindowedAggregate {
  /** Bucket key: bundle build-id / deploy SHA. */
  release: string | null;
  /** Bucket key: page origin observed. */
  origin: string;
  /** Bucket key: route template. */
  route_template: string;
  /** Bucket key: incident kind. */
  kind: ClientTelemetryKind;
  /** Bucket key: the host the bundle called (the Φ_host spine). */
  request_host: string | null;

  /** Window start (ISO 8601). */
  window_start: string;
  /** Window end (ISO 8601). */
  window_end: string;
  /** The rolled-up incident count in this bucket. */
  count: number;
  /**
   * Distinct affected sessions in this bucket (from ``session_hash`` — the
   * blast-radius numerator). Always a count, never the hashes themselves.
   */
  distinct_sessions: number;
  /** Failure-class breakdown for the bucket (cors / network / …). */
  failure_class?: ClientTelemetryFailureClass;
}
