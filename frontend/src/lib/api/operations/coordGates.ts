/**
 * `/operations/gates/*` — the coord gate proxies: the gate list, and the
 * operator verbs on one gate (approve, reject, reopen, mute, unmute, snooze,
 * force-clear, continuation-cancel, change audience).
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D5, Phase 7 batch 1). These replace the `gate*Url` builders of
 * `components/operations/utils.ts` (whose caller was
 * `admin/coord/gates/_components/GateActions.tsx`) and the bare `fetch` gate
 * calls of `components/admin/agent-claims/AgentClaimsDashboard.tsx`. Every
 * function calls `httpClient.fetch` on the RELATIVE `OPERATIONS_BASE` (D6)
 * with its URL inline and states its retry policy; a non-2xx rejects through
 * `readJson` with `<METHOD> <url> failed: <status> - <body>`, which a caller
 * reads back with `httpStatusOf` / `httpBodyOf`.
 *
 * The writes resolve `null` for a 2xx whose body does not parse: no caller
 * reads coord's answer (they refetch the list instead — coord is the source
 * of truth), and the 2xx is the fact that the verb landed.
 *
 * **Retry.** Every write is `idempotent: false`, which is what these POST /
 * PATCH calls already were by method: a 5xx is never re-sent. Several are
 * not free to repeat — approve and force-clear fire an armed continuation,
 * reopen clones the gate into a new one — and the rest are kept on the same
 * footing rather than widened, because this move is not the change that
 * re-decides them. A 429 (nothing committed) still retries.
 *
 * Handlers mirrored (`backend/app/api/v1/endpoints/operations/__init__.py`):
 * `get_gates_list`, `approve_gate`, `reject_gate` (which also serves
 * `/reopen`), `mute_gate`, `unmute_gate`, `snooze_gate`, `force_clear_gate`,
 * `continuation_cancel_gate` and `set_gate_audience`. None declares a
 * `response_model`.
 */

import type { HttpOptions } from "@/services/http-client";
import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** One gate row of `GET /gates/list` — coord's `/coord/gates` row, raw. */
export interface GateListEntry {
  gate_id: string;
  claim_kind: string | null;
  resource_key: string | null;
  plan_id: string | null;
  phase_name: string | null;
  predicate: Record<string, unknown>;
  verdict: "open" | "cleared" | "failed";
  verdict_reason: string | null;
  registered_by: string | null;
  created_at: string;
  evaluated_at: string | null;
  cleared_at: string | null;
}

/**
 * `GET /gates/list` — `get_gates_list`, a raw passthrough of coord's
 * `/coord/gates`: a bare array, or `{gates: [...]}`. Both are accepted
 * because no build pins which one this coord answers.
 */
export type GatesListResponse = GateListEntry[] | { gates?: GateListEntry[] };

/** Who an `operator_approval` gate's clearance is addressed to. */
export type GateAudience = "operator" | "agent";

/** Body of `POST /gates/{gate_id}/continuation-cancel`. */
export interface GateContinuationCancelBody {
  cancelled_by: string;
  reason: string;
}

/** `GET /gates/list` — the active tenant's gates, unfiltered. */
export async function fetchGatesList(
  options: HttpOptions = {}
): Promise<GatesListResponse> {
  const url = `${OPERATIONS_BASE}/gates/list`;
  const res = await httpClient.fetch(url, {
    ...options,
    method: "GET",
    idempotent: true,
  });
  return readJson<GatesListResponse>(res, `GET ${url}`);
}

/** `POST /gates/{gate_id}/approve` — clear an open `operator_approval` gate. */
export async function approveGate(gateId: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/approve`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({}),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `POST /gates/{gate_id}/reject` — mark an open `operator_approval` gate
 * failed. `body.reason` is optional; an empty body is sent without one.
 */
export async function rejectGate(
  gateId: string,
  body: { reason?: string } = {}
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/reject`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/** `POST /gates/{gate_id}/reopen` — clone a cleared/failed gate into a new open one. */
export async function reopenGate(gateId: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/reopen`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({}),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/** `POST /gates/{gate_id}/mute` — the reversible quiet toggle, on. */
export async function muteGate(gateId: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/mute`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({}),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/** `POST /gates/{gate_id}/unmute` — the reversible quiet toggle, off. */
export async function unmuteGate(gateId: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/unmute`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({}),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/** `POST /gates/{gate_id}/snooze` — quiet the gate until `until` (RFC 3339). */
export async function snoozeGate(
  gateId: string,
  until: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/snooze`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ until }),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `POST /gates/{gate_id}/force-clear` — clear a gate regardless of its
 * predicate (DESTRUCTIVE). `reason` is required by coord.
 */
export async function forceClearGate(
  gateId: string,
  reason: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/force-clear`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({ reason }),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `POST /gates/{gate_id}/continuation-cancel` — cancel the gate's armed or
 * dispatched continuation so clearing it no longer spawns the follow-up.
 */
export async function cancelGateContinuation(
  gateId: string,
  body: GateContinuationCancelBody
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/continuation-cancel`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/** `PATCH /gates/{gate_id}/audience` — re-classify the gate's clearance audience. */
export async function setGateAudience(
  gateId: string,
  audience: GateAudience
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/audience`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify({ audience }),
    idempotent: false,
  });
  return readJson<unknown>(res, `PATCH ${url}`, { unparseable: "null" });
}
