/**
 * Wire types for coord's fleet-policy surface, shared by every domain that
 * renders a dial.
 *
 * Mirrors the two fleet-policy models in
 * `backend/app/api/v1/endpoints/operations.py` (`FleetPolicyView`,
 * `FleetPolicyWriteResult`), which in turn proxy coord's
 * `GET`/`PUT /coord/fleet-policy`.
 *
 * Promoted out of `plan-library/types.ts` when the `policy_write` dial became a
 * second consumer (plan
 * `2026-08-06-agent-policy-replace-and-write-autonomy-dial` §4). One domain's
 * feature directory was the right home while there was one domain; a second
 * copy would have been two definitions of one wire contract. `plan-library`
 * re-exports these so its own imports are unchanged.
 *
 * **The distinction these types exist to protect:** `resolved_scope` separates
 * "off because nobody ever wrote a row" (`"none"`) from "off because someone
 * turned it off" (a real band). Coord folds `master_enabled` into
 * `effective_level`, so both render as the string `"off"` — and a consumer that
 * cannot tell them apart cannot implement a code default without also
 * overriding an operator's explicit decision.
 */

export interface FleetPolicyView {
  domain: string;
  /** What devices ACTUALLY resolve — not necessarily what was last written. */
  effective_level: string;
  master_enabled: boolean;
  /** `"repo" | "tenant" | "system"`, or `"none"` when NO row matched. */
  resolved_scope: string;
  /**
   * Whether the caller may write, computed with the SAME effective-tenant rule
   * the PUT is gated on — not coord's cross-tenant `is_admin` union. Gating a
   * write button on `is_admin` lights it for an operator the write is about to
   * 403.
   */
  can_edit: boolean;
  /**
   * Control blocks coord returned that this view does not carry. Named rather
   * than silently dropped, so a reader who wonders where `controls` went gets
   * an answer.
   */
  keys_not_shown: string[];
  /**
   * `"fleet_resources_row"` — those blocks are a DIFFERENT domain's data and
   * must never be read as this domain's. `"this_domain"` — the caller asked
   * about `fleet_resources` itself. `null` — coord sent none.
   */
  keys_not_shown_source: "fleet_resources_row" | "this_domain" | null;
}

export interface FleetPolicyWriteResult {
  ok: boolean;
  domain: string;
  written_level: string | null;
  written_master_enabled: boolean | null;
  versioned: boolean | null;
  version: number | null;
  updated_by: string | null;
  /** A SECOND, fresh read. `null` + `readback_error` = UNKNOWN, not "applied". */
  effective: FleetPolicyView | null;
  readback_error: string | null;
}

/** The backend proxy both dials read and write. */
export const FLEET_POLICY_API = "/api/v1/operations/fleet-policy";
