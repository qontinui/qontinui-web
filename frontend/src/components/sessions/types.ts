// ============================================================================
// Sessions panel — wire types
//
// Mirrors `qontinui-coord/src/sessions.rs` (Phase 1 SHIPPED 2026-05-22).
// The web backend `/api/v1/operations/sessions*` endpoints transparently
// proxy these payloads — no shape change between coord and the browser.
// ============================================================================

/** `coord.sessions.session_kind` enum. snake_case wire form. */
export type SessionKind =
  | "terminal_shell"
  | "terminal_claude"
  | "agentic"
  | "workflow"
  | "automation"
  | "debug";

/** `coord.sessions.state` enum. snake_case wire form. */
export type SessionState =
  | "active"
  | "pending_resolution"
  | "stale"
  | "closed";

/**
 * Typed session intent stored verbatim in `coord.sessions.intent` (JSONB).
 * Mirrors `qontinui-coord/src/sessions.rs::Intent`.
 */
export interface SessionIntent {
  purpose: string;
  repo?: string;
  branch?: string;
  declared_paths?: string[];
  share_output?: boolean;
  redact_secrets?: boolean | null;
}

/**
 * Common row shape returned by `POST`, `PATCH`, `GET /sessions`.
 * Matches `qontinui-coord/src/sessions.rs::SessionRow`.
 */
export interface SessionRow {
  id: string;
  tenant_id: string;
  device_id: string;
  session_kind: SessionKind | string;
  intent: SessionIntent | Record<string, unknown>;
  state: SessionState | string;
  started_at: string | null;
  last_heartbeat_at: string | null;
  closed_at: string | null;
  parent_session_id: string | null;
  repo: string | null;
  branch: string | null;
}

/** Wire shape from `GET /api/v1/operations/sessions`. */
export interface SessionListResponse {
  count: number;
  scope: string;
  sessions: SessionRow[];
}

/**
 * One row from `coord.session_events`. Returned by the SSE replay step
 * and live-tail.
 */
export interface SessionEventRow {
  id: number;
  session_id: string;
  seq: number;
  event_kind: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

/** Wire shape from `GET /api/v1/operations/tenants`. */
export interface TenantListResponse {
  tenants: { id: string; slug: string; name: string }[];
  active_tenant_id: string;
}

/**
 * Heartbeat-staleness buckets per plan §D13.
 *
 * - fresh:  last_heartbeat_at < 45s   → green
 * - stale:  45s ≤ ... < 180s          → yellow ("missed 3 hb")
 * - dead:   ≥ 180s                    → red    ("auto-close pending")
 *
 * `unknown` covers sessions with no heartbeat yet — usually
 * sub-second-old new rows.
 */
export type HeartbeatHealth = "fresh" | "stale" | "dead" | "unknown";

export function classifyHeartbeat(
  lastHeartbeatAt: string | null
): HeartbeatHealth {
  if (!lastHeartbeatAt) return "unknown";
  const ageMs = Date.now() - new Date(lastHeartbeatAt).getTime();
  if (Number.isNaN(ageMs) || ageMs < 0) return "fresh";
  if (ageMs < 45_000) return "fresh";
  if (ageMs < 180_000) return "stale";
  return "dead";
}
