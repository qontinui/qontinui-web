/**
 * `/operations/gates/{id}/*`: the operator verbs on a coord gate — approve,
 * reopen, mute / unmute, snooze, set audience, reject, force-clear and cancel
 * the armed continuation.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * D2 + D5 + D6, Phase 7). Every function calls `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE` (same-origin, D6) with its URL inline and returns
 * the raw `Response`: the gates table reads the status AND the unparsed body
 * text of a refusal (coord's own message is the toast's description), and a
 * 2xx is the action landing, so neither may be folded into a thrown error.
 *
 * Each write keeps `httpClient`'s default retry policy. The body is the
 * caller's: `{}` where the verb takes none.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE } from "./base";

/** `POST /gates/{id}/approve` — clear an `operator_approval` gate. */
export function postGateApprove(
  gateId: string,
  body: Record<string, unknown>
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/approve`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

/** `POST /gates/{id}/reopen` — clone a cleared/failed gate into a new open gate. */
export function postGateReopen(
  gateId: string,
  body: Record<string, unknown>
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/reopen`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

/** `PATCH /gates/{id}/audience` — re-classify a gate's `clearance_audience`. */
export function patchGateAudience(
  gateId: string,
  body: Record<string, unknown>
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/audience`,
    { method: "PATCH", body: JSON.stringify(body) }
  );
}

/** `POST /gates/{id}/mute` — the reversible mute toggle, on. */
export function postGateMute(
  gateId: string,
  body: Record<string, unknown>
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/mute`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

/** `POST /gates/{id}/unmute` — the reversible mute toggle, off. */
export function postGateUnmute(
  gateId: string,
  body: Record<string, unknown>
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/unmute`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

/** `POST /gates/{id}/snooze` — snooze until `{until: <rfc3339>}`. */
export function postGateSnooze(
  gateId: string,
  body: Record<string, unknown>
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/snooze`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

/** `POST /gates/{id}/reject` — reject an OPEN `operator_approval` gate. Body `{reason?}`. */
export function postGateReject(
  gateId: string,
  body: Record<string, unknown>
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/reject`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

/**
 * `POST /gates/{id}/force-clear` — clear a gate regardless of its predicate
 * (DESTRUCTIVE). Body `{reason}` is REQUIRED.
 */
export function postGateForceClear(
  gateId: string,
  body: Record<string, unknown>
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/force-clear`,
    { method: "POST", body: JSON.stringify(body) }
  );
}

/**
 * `POST /gates/{id}/continuation-cancel` — cancel a gate's armed/dispatched
 * continuation. Body `{cancelled_by, reason}`.
 */
export function postGateContinuationCancel(
  gateId: string,
  body: Record<string, unknown>
): Promise<Response> {
  return httpClient.fetch(
    `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/continuation-cancel`,
    { method: "POST", body: JSON.stringify(body) }
  );
}
