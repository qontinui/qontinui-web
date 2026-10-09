/**
 * The gate ACTION routes of `/operations` (plan
 * `2026-06-05-plan-gate-web-surface-and-productization` Phase 2), driven by
 * `/admin/coord/gates` (`GateActions.tsx`). All tenant-scoped server-side via
 * the operator -> tenant_id resolver; the caller never passes a tenant_id.
 *
 * There is no gates LIST read here: the console has exactly one
 * (`adminDevService.getOverview()` -> `/api/v1/admin-dev/overview`), and the
 * approve / reject pair that `coordClaims.ts` carries is the claims
 * dashboard's own.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`
 * Phase 7). Every function returns the raw `Response` rather than parsed JSON:
 * `GateActions.runAction` surfaces coord's own error text (`res.text()`) in a
 * toast and falls back to `HTTP <status>`, so it must see the status and body
 * of a non-2xx instead of a rejected promise. Each function calls
 * `httpClient.fetch` directly with its URL inline (a shared `request(path)`
 * helper would defeat `route-walker.test.ts`).
 *
 * None is declared idempotent: approve / reject / force-clear / continuation
 * cancel are one-shot state changes, and a replayed reopen clones a second gate.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE } from "./base";

/** Request shape shared by the gate actions: a JSON body, POST unless noted. */
export interface GateActionRequest {
  body?: Record<string, unknown>;
}

function jsonBody(req?: GateActionRequest): string {
  return JSON.stringify(req?.body ?? {});
}

/** `POST /gates/{gate_id}/approve` — clear an `operator_approval` gate. */
export function postGateApprove(
  gateId: string,
  req?: GateActionRequest
): Promise<Response> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/approve`;
  return httpClient.fetch(url, {
    method: "POST",
    body: jsonBody(req),
    idempotent: false,
  });
}

/** `POST /gates/{gate_id}/reopen` — clone a cleared/failed gate into a new open one. */
export function postGateReopen(
  gateId: string,
  req?: GateActionRequest
): Promise<Response> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/reopen`;
  return httpClient.fetch(url, {
    method: "POST",
    body: jsonBody(req),
    idempotent: false,
  });
}

/** `PATCH /gates/{gate_id}/audience` — re-classify `clearance_audience`. Body `{audience}`. */
export function patchGateAudience(
  gateId: string,
  req?: GateActionRequest
): Promise<Response> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/audience`;
  return httpClient.fetch(url, { method: "PATCH", body: jsonBody(req) });
}

/** `POST /gates/{gate_id}/mute` — reversible mute. */
export function postGateMute(
  gateId: string,
  req?: GateActionRequest
): Promise<Response> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/mute`;
  return httpClient.fetch(url, { method: "POST", body: jsonBody(req) });
}

/** `POST /gates/{gate_id}/unmute` — undo a mute. */
export function postGateUnmute(
  gateId: string,
  req?: GateActionRequest
): Promise<Response> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/unmute`;
  return httpClient.fetch(url, { method: "POST", body: jsonBody(req) });
}

/** `POST /gates/{gate_id}/snooze` — snooze until `{until: <rfc3339>}`. */
export function postGateSnooze(
  gateId: string,
  req?: GateActionRequest
): Promise<Response> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/snooze`;
  return httpClient.fetch(url, { method: "POST", body: jsonBody(req) });
}

/** `POST /gates/{gate_id}/reject` — reject an OPEN `operator_approval` gate. Body `{reason?}`. */
export function postGateReject(
  gateId: string,
  req?: GateActionRequest
): Promise<Response> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/reject`;
  return httpClient.fetch(url, {
    method: "POST",
    body: jsonBody(req),
    idempotent: false,
  });
}

/**
 * `POST /gates/{gate_id}/force-clear` — force-clear a gate regardless of its
 * predicate (DESTRUCTIVE). Body `{reason}` REQUIRED.
 */
export function postGateForceClear(
  gateId: string,
  req?: GateActionRequest
): Promise<Response> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/force-clear`;
  return httpClient.fetch(url, {
    method: "POST",
    body: jsonBody(req),
    idempotent: false,
  });
}

/**
 * `POST /gates/{gate_id}/continuation-cancel` — cancel a gate's armed or
 * dispatched continuation. Body `{cancelled_by, reason}`.
 */
export function postGateContinuationCancel(
  gateId: string,
  req?: GateActionRequest
): Promise<Response> {
  const url = `${OPERATIONS_BASE}/gates/${encodeURIComponent(gateId)}/continuation-cancel`;
  return httpClient.fetch(url, {
    method: "POST",
    body: jsonBody(req),
    idempotent: false,
  });
}
