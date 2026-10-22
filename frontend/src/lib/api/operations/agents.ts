/**
 * The spawn modal's `/operations` routes: the per-device Claude account
 * roster (`GET /claude-accounts`) and the spawn itself (`POST /agents/spawn`);
 * and the runners page's agent-session routes, the per-device census
 * (`GET /sessions/fleet`) and the session control write
 * (`POST /sessions/{session_id}/control`).
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * D5, Phase 6). Both calls used to be a bare `fetch` to the absolute
 * `${ApiConfig.API_BASE_URL}/api/v1/operations` base, which in production is
 * cross-origin and carried neither a bearer nor a cookie — the request the
 * backend answers `401 not_authenticated`. On `httpClient` they carry the
 * bearer, `X-Qontinui-Active-Tenant` (so the modal now honours the operator's
 * selected tenant) and a stated retry policy.
 *
 * Each function calls `httpClient.fetch` directly with its URL inline over
 * `OPERATIONS_BASE` (same-origin — see `base.ts`); a shared `request(path)`
 * helper would be a wrapper of a wrapper, which `route-walker.test.ts` cannot
 * resolve.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** One row of coord's per-device Claude account feed, as served by the
 *  qontinui-web proxy `GET /operations/claude-accounts` (plan
 *  `2026-08-25-general-purpose-session-spawn-machine-account-prompt`
 *  Phase 2).
 *
 *  Identity on the wire is `account_label` — the config-dir BASENAME
 *  (`.claude-gmail`), never a local path. That is a deliberate contract of
 *  the runner's ingest side, so nothing here may render or send a path.
 *  Note the read side spells it `account_label`, not `label`.
 *
 *  Every observation-shaped field is `| null` on purpose: coord serves
 *  `is_active` / `account_selection_mode` as null on a deployment whose
 *  `coord.claude_account_usage` predates alembic `coord_claude_acct_usage_02`,
 *  and null there means UNKNOWN — never `false`, and never the
 *  runner's default mode. */
export interface ClaudeAccountRow {
  device_id: string;
  account_label: string;
  weekly_utilization?: number | null;
  weekly_resets_at?: string | null;
  session_utilization?: number | null;
  session_resets_at?: string | null;
  model_limits?: unknown[];
  exhausted?: boolean | null;
  source?: string | null;
  error?: boolean | null;
  /** Coord's computed freshness verdict (30 min since the device's last
   *  report). `true` means the feed STOPPED — the numbers beside it are a
   *  last-known snapshot, not a current one. */
  stale?: boolean | null;
  /** Which account the machine's rotation actually picked. `null`/absent =
   *  unknown (the reporting runner predates the field). */
  is_active?: boolean | null;
  /** A runner `AccountSelectionMode` wire spelling (`manual` |
   *  `least_usage` | `highest_expected_usage` | `weighted_random` |
   *  `alternating_handoff`) or null. Null = unknown, NOT the runner's
   *  default. */
  account_selection_mode?: string | null;
}

export interface ClaudeAccountsPayload {
  accounts?: unknown;
  /** `false` = coord has no `coord.claude_account_usage` table yet;
   *  `null`/absent = coord did not say. Both are UNKNOWN, not "no accounts". */
  table_provisioned?: boolean | null;
  /** `false` = the table predates the `is_active` / `account_selection_mode`
   *  columns, so the SELECTION half of every row is unknown while the usage
   *  half is real. */
  columns_provisioned?: boolean | null;
}

/**
 * `GET /claude-accounts` — the tenant-wide Claude account roster
 * (`operations/__init__.py` `get_claude_accounts`, proxying coord's
 * `/coord/claude-accounts/usage`), parsed.
 *
 * Same-origin over `OPERATIONS_BASE` through `httpClient.fetch`, with the
 * init `httpClient.get` used to send (`method: "GET"`, declared
 * `idempotent`). A non-2xx rejects through `readJson` with
 * `GET /api/v1/operations/claude-accounts failed: <status> - <body>`, which
 * `httpStatusOf` reads the status back out of. The body is returned as
 * served: `accounts` is typed `unknown` because a row this surface cannot
 * read is dropped and counted by the caller, never guessed at.
 */
export async function fetchClaudeAccounts(): Promise<ClaudeAccountsPayload> {
  const url = `${OPERATIONS_BASE}/claude-accounts`;
  const res = await httpClient.fetch(url, {
    method: "GET",
    idempotent: true,
  });
  return readJson<ClaudeAccountsPayload>(res, `GET ${url}`);
}

/**
 * `POST /agents/spawn` — mint a coord agent (`operations/__init__.py`
 * `post_agents_spawn`, proxying coord's `/agents/spawn`). Returns the raw
 * `Response`.
 *
 * Raw, not parsed, because the caller's refusal UX reads the status AND the
 * unparsed body text (`describeSpawnRefusal`), and tells "coord answered 2xx
 * but the body is unreadable" apart from a refusal — a 2xx IS the spawn
 * landing, so it must never be folded into a thrown error.
 *
 * At most one request reaches the spawn handler: `idempotent: false` keeps a
 * 5xx from being re-issued (a `504` from the proxy can arrive after coord
 * already minted the agent), and `maxRetries: 0` suppresses the 429 arm too. A
 * blind retry could make two sessions. The one replay `httpClient` still makes
 * is a stale-token `401`: it refreshes the token and resends once. That is
 * safe, because a request refused at authentication never reached the handler.
 */
export function spawnAgent(body: Record<string, unknown>): Promise<Response> {
  return httpClient.fetch(`${OPERATIONS_BASE}/agents/spawn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    idempotent: false,
    maxRetries: 0,
  });
}

/**
 * `GET /sessions/fleet?device_id=&limit=` (`get_coord_sessions_fleet`) — coord's
 * per-device agent-session census, interpreted by `parseFleetSessions`
 * (`components/operations/runnerStatus.ts`). Returned `unknown`: the handler
 * passes coord's body through, and that parser is what decides it is usable.
 * Coord clamps `limit` to its own `MAX_LIMIT`.
 */
export async function fetchDeviceFleetSessions(
  deviceId: string,
  limit: number,
  options: HttpOptions = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/sessions/fleet?device_id=${encodeURIComponent(deviceId)}&limit=${limit}`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `POST /sessions/{session_id}/control` body — `SessionControlRequestBody`. */
export interface SessionControlRequest {
  action: string;
  reason?: string;
}

/**
 * `POST /sessions/{session_id}/control` acknowledgement — coord's `202`
 * `{event_id, session_id, device_id, action}`, echoed by
 * `post_coord_session_control`; `{}` when coord's 2xx body was not JSON.
 */
export interface SessionControlAck {
  event_id?: unknown;
  session_id?: unknown;
  device_id?: unknown;
  action?: unknown;
}

/**
 * `POST /sessions/{session_id}/control` (`post_coord_session_control`) — ask
 * the runner holding a session to finish-and-close it, or to stop it at its
 * next boundary.
 *
 * `idempotent: false`: coord records every accepted request as a durable
 * `control_request` session event and publishes it to the device, so a 5xx
 * re-issued after coord had already accepted the first would publish it
 * twice. A 2xx whose body does not parse resolves `null` — the request was
 * still recorded.
 */
export async function postSessionControl(
  sessionId: string,
  body: SessionControlRequest
): Promise<SessionControlAck | null> {
  const url = `${OPERATIONS_BASE}/sessions/${encodeURIComponent(sessionId)}/control`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<SessionControlAck>(res, `POST ${url}`, {
    unparseable: "null",
  });
}
