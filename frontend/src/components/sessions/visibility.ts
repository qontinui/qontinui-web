/**
 * Claim-steal visibility filter — Phase 6 of
 * `2026-05-22-coord-native-session-coordination.md`.
 *
 * Coord stamps every `claim_stolen` event payload with a `policy`
 * field at emit time. The tenant policy enum is:
 *
 *   - `public_to_tenant`  (default — coordination IS the product)
 *   - `involved_only`     (only the stealer + victim machines see it)
 *   - `audit_only`        (tenant admins query the audit log;
 *                          dashboard hides the row from the feed)
 *
 * The filter below applies the same gating client-side. Coord cannot
 * filter the SSE stream itself today because the per-session SSE
 * route is keyed by session_id, not viewer — moving the filter to
 * the server would require a permission-aware fan-out that lives
 * outside Phase 6's scope. Client-side is sufficient because:
 *
 *  - the per-session SSE is already tenant-scoped (only the owning
 *    tenant's sessions are reachable),
 *  - the row contains no secrets — just (machine_id, reason) — so
 *    worst-case the client-side filter is a UX nicety rather than a
 *    security boundary,
 *  - audit-only events are still logged in `coord.session_events`,
 *    so administrators can recover them out of band.
 *
 * This module is the single place to look for that policy rendering;
 * SessionDetail consumes it.
 */

import type { SessionEventRow } from "./types";

export type ClaimStealVisibility =
  | "public_to_tenant"
  | "involved_only"
  | "audit_only";

/**
 * Wire shape coord emits for `claim_stolen` events. Mirrors
 * `qontinui-coord/src/sessions.rs::post_steal`'s payload JSON
 * (built directly from the StealSessionRequest + the loaded session
 * row + the loaded tenant policy).
 */
export interface ClaimStolenPayload {
  event_kind?: "claim_stolen";
  session_id?: string;
  tenant_id?: string;
  originating_machine_id?: string;
  stealing_machine_id?: string;
  reason?: string;
  policy?: ClaimStealVisibility | string;
  [extra: string]: unknown;
}

export interface VisibilityContext {
  /**
   * The current viewer's identity for "am I involved?" checks. For
   * dashboard browsers this is the per-tab UUID minted by
   * `StealModal.getDashboardMachineId()`. For an embedded view in a
   * runner it would be the runner's `machine_id`.
   */
  viewerMachineId?: string;
  /**
   * The `device_id` of the session being viewed — also counted as
   * "involved" since the session's home machine is the victim of any
   * steal targeting it.
   */
  sessionDeviceId?: string;
}

/**
 * Return true when the `claim_stolen` event should be shown to the
 * viewer given the policy stamped on it.
 *
 * Falls back to `public_to_tenant` semantics when the payload is
 * missing a policy field — defensive against legacy events written
 * before Phase 6 (the `policy` column was added in Phase 1 alongside
 * the table, but pre-Phase-6 callers may have written events without
 * routing through `post_steal`).
 */
export function isClaimStolenVisible(
  payload: ClaimStolenPayload,
  ctx: VisibilityContext
): boolean {
  const policy: ClaimStealVisibility =
    (payload.policy as ClaimStealVisibility) ?? "public_to_tenant";

  switch (policy) {
    case "public_to_tenant":
      return true;

    case "audit_only":
      // Never shown in the live feed; tenant admins query the audit
      // log separately.
      return false;

    case "involved_only": {
      const stealer = payload.stealing_machine_id;
      const victim = payload.originating_machine_id;
      const viewerIds = new Set(
        [ctx.viewerMachineId, ctx.sessionDeviceId].filter(
          (s): s is string => !!s
        )
      );
      return (
        (!!stealer && viewerIds.has(stealer)) ||
        (!!victim && viewerIds.has(victim))
      );
    }

    default:
      // Unknown policy — fail-open to `public_to_tenant` so admins
      // can audit a misconfiguration. The opposite (fail-closed)
      // hides everything and is hard to diagnose; the data is
      // already tenant-scoped at the SSE layer.
      return true;
  }
}

/**
 * Filter an event row stream, dropping any `claim_stolen` rows the
 * viewer should not see per their tenant's policy. Non-stolen rows
 * pass through unchanged.
 */
export function filterEventsByPolicy(
  events: SessionEventRow[],
  ctx: VisibilityContext
): SessionEventRow[] {
  return events.filter((evt) => {
    if (evt.event_kind !== "claim_stolen") return true;
    return isClaimStolenVisible(evt.payload as ClaimStolenPayload, ctx);
  });
}
