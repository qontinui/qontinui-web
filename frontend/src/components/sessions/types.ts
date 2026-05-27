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
export type SessionState = "active" | "pending_resolution" | "stale" | "closed";

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

/**
 * One PTY output chunk — Phase 8 of
 * `2026-05-23-coord-native-sessions-phase-7-10.md`.
 *
 * Shared shape across the warm/cold history fetch
 * (`GET /sessions/:id/output`) and the live-tail `output_chunk` SSE
 * frames (`GET /sessions/:id/events`). Mirrors
 * `qontinui-coord/src/sessions.rs::OutputChunk`.
 *
 * `chunk_offset` is the runner-side monotonic byte counter for the
 * session — a stable FIFO key (`PRIMARY KEY (session_id, chunk_offset)`
 * coord-side) and the de-dupe key the dashboard uses to reconcile the
 * bootstrap history with the live tail. `payload_b64` decodes to raw
 * PTY bytes (already redacted runner-side when the session opted in).
 */
export interface OutputChunk {
  chunk_offset: number;
  payload_b64: string;
}

/**
 * Wire shape from `GET /api/v1/operations/sessions/:id/output`.
 * Matches the coord response envelope in
 * `qontinui-coord/src/sessions.rs::get_output`.
 */
export interface OutputHistoryResponse {
  session_id: string;
  tier: "warm" | "cold" | string;
  chunks: OutputChunk[];
  count: number;
}

/**
 * Live-tail `output_chunk` frame body, as published on the JetStream
 * session-output subject and surfaced via the `/events` SSE stream's
 * `event: live` frames. Carries the same `chunk_offset` + `payload_b64`
 * as a history `OutputChunk`, plus routing identifiers. NOT a
 * `SessionEventRow` (no `seq` / `occurred_at`) — output chunks live in
 * `coord.session_output`, not `coord.session_events`, so they never
 * appear in the events replay. See
 * `qontinui-coord/src/sessions.rs::post_output`.
 */
export interface OutputChunkFrame extends OutputChunk {
  event_kind: "output_chunk";
  session_id: string;
  tenant_id?: string;
  device_id?: string;
}

/** A registered canonical repo from `GET /api/v1/operations/repos`. */
export interface RegisteredRepo {
  repo: string;
  mirror_state?: string | null;
  last_reconciled_at?: string | null;
  created_at?: string | null;
}

/** Wire shape from `GET /api/v1/operations/repos`. */
export interface RegisteredReposResponse {
  repos: RegisteredRepo[];
}

/** Wire shape from `GET /api/v1/operations/tenants`. */
export interface TenantListResponse {
  tenants: { id: string; slug: string; name: string }[];
  active_tenant_id: string;
}

/** A single claim from `coord.claims`. */
export interface SessionClaim {
  id: string;
  kind: string;
  resource_key: string;
  machine_id: string;
  tenant_id?: string;
  acquired_at: string;
  expires_at: string | null;
  metadata?: Record<string, unknown>;
}

/** Wire shape from `GET /api/v1/operations/sessions/:id/claims`. */
export interface SessionClaimsResponse {
  claims: SessionClaim[];
  count: number;
}

/** A single agent_status row from `coord.agent_status`. */
export interface AgentStatus {
  id: string;
  device_id: string;
  tenant_id: string;
  status_text: string | null;
  blocked_on: string | null;
  intent_globs: string[] | null;
  correlation_topic: string | null;
  updated_at: string;
  expires_at: string | null;
}

/** Wire shape from `GET /api/v1/operations/sessions/:id/agent-status`. */
export interface AgentStatusResponse {
  agents: AgentStatus[];
  count: number;
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
