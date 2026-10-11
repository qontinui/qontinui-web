/**
 * `/operations/coord/prompt-document-kind-tiers` — the per-KIND agent
 * authorship tier the coord proxy serves: one read and a per-kind set / clear.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Every function calls `httpClient.fetch` on the RELATIVE
 * `OPERATIONS_BASE` with its URL inline and parses through `readJson`.
 */

import { httpClient } from "@/services/service-factory";
import type { AgentWriteTier } from "@/app/(app)/admin/coord/prompt-documents/types";
import { OPERATIONS_BASE, readJson } from "./base";

/**
 * One kind's row, exactly as coord projects it.
 *
 * Coord answers one row per KIND rather than one per stored row, and the extra
 * fields are the reason: `builtin_default_tier` is a compile-time fact that is
 * not in the table at all, so a response listing only stored rows would make
 * this console infer it — and it would infer it wrong for precisely the kinds
 * where the answer matters.
 */
export interface KindTierRow {
  kind: string;
  /**
   * The stored tier, or `null` for "this tenant has expressed no opinion".
   *
   * `null` is ALSO what coord sends for a stored value it cannot interpret —
   * `unreadable` is the only thing separating the two, and they resolve in
   * opposite directions. Never render this field without consulting that one.
   */
  tier: AgentWriteTier | null;
  /**
   * A row EXISTS and coord cannot read its `tier`. Enforcement fail-closes to
   * `deny` on it, so the honest display is UNKNOWN — never coord's built-in
   * default, which is what an unset row falls through to.
   */
  unreadable: boolean;
  /**
   * The TIER coord's compile-time constant gives this kind, in the same
   * vocabulary as `tier` and `effective_tier`. A stored tier at either level
   * moves it, in EITHER direction.
   *
   * `"allow"` for a kind with no kind-wide entry at all.
   *
   * **Tier-valued, not boolean.** It was `builtin_default_denies: boolean`
   * until coord gave the six intent kinds a compiled default of
   * `"allow_with_notification"`, which a boolean cannot hold: it would have
   * flipped to `false` for those kinds and this console's "coord's compile-time
   * default denies this kind" copy would have become silently wrong in the
   * permissive direction.
   *
   * Typed as `string`, not `AgentWriteTier`, for the same reason
   * `effective_tier` is: this interface is a cast over `JSON.parse` output
   * rather than a check. Optional because a coord that predates the field sends
   * nothing — UNKNOWN, never open.
   *
   * **The `floor` and `settable` booleans that used to sit here are GONE.**
   * Coord removed the unliftable kind-wide FLOOR level from its resolver, so
   * both were permanently `false` / `true` — a dead guard with a `Lock` icon
   * attached in this console, which is a promise about a control that no longer
   * exists. Every kind is settable now, and there is nothing left for a
   * `settable` field to assert.
   */
  builtin_default_tier?: string;
  /**
   * **What coord will actually enforce** for a document of this kind with no
   * per-document row of its own — derived SERVER-SIDE by coord's own resolver.
   *
   * This is the field the badge renders. The fields above are the WHY, not the
   * answer: re-deriving the answer from them puts the never-overstate-access
   * rule in this console, where the obvious join
   * (`tier ?? builtin_default_tier`) renders `allow` for an unreadable tier on
   * a kind whose compiled default allows — which coord DENIES.
   *
   * Typed as `string`, not `AgentWriteTier`: this interface is a cast over
   * `JSON.parse` output rather than a check, so a tier this build predates
   * arrives here as an arbitrary string. Narrow it with `isAgentWriteTier`
   * before rendering, and treat anything else as UNKNOWN.
   *
   * Optional because a coord that predates the field sends nothing — which is
   * UNKNOWN, never open.
   */
  effective_tier?: string;
  /**
   * Which step of coord's resolution order produced `effective_tier`:
   * `"kind"` (this tenant's stored setting) or `"default"` (coord's
   * compile-time answer, whatever tier that is).
   *
   * There was a `"floor"` arm until coord deleted the floor level; it is gone
   * rather than kept as a value nothing can produce.
   *
   * Not derivable from the other fields, and it changes the REMEDY: an operator
   * reading "denied" needs to know whether their own setting or a coord
   * constant did it.
   */
  effective_source?: string;
  /**
   * The document NAMES under this kind that a kind-wide `allow` will NOT reach
   * — coord's compiled-in per-document denies, answered at resolution step 2b,
   * ABOVE the per-kind table this control writes.
   *
   * Without it the control misreports in the permissive direction, which is the
   * one that matters: `policy` arrives with a live control and a
   * `builtin_default_tier` of `"allow"`, so an operator setting it to `allow`
   * would reasonably read that as opening every policy document — including
   * `policy/session-protocol`, `policy/security-and-autonomy` and
   * `policy/escalation-bar`, the three documents that ARE the authority
   * interpreting every other document. It does not, and coord's resolver is
   * what makes that true; this field is what makes it VISIBLE.
   *
   * Empty for most kinds, including all six intent kinds — their compiled-in
   * answer is a liftable `KindDefaultTier`, which is exactly what this lever
   * exists to move.
   *
   * Optional because a coord that predates the field sends nothing. Absent is
   * UNKNOWN, and the honest render for UNKNOWN here is nothing at all — an
   * empty carve-out list would be a positive claim that a kind-wide `allow`
   * reaches every document, which is the exact overstatement this field exists
   * to prevent.
   */
  protected_documents?: string[];
}

export interface KindTiersResponse {
  kinds: KindTierRow[];
  vocabulary: AgentWriteTier[];
  /**
   * Whether the deployed coord ENFORCES the `allow_with_notification`
   * precondition. Coord sends it on every response.
   *
   * It was `false` when this hook was written and is `true` from coord#1702,
   * which shipped the precondition. Read it, never assume either value — the
   * console talks to whatever coord is deployed, and a stale local belief about
   * this flag is how three hardcoded "NOT YET ENFORCED" strings went on
   * describing a world that had already changed.
   *
   * Typed `boolean` but arriving through `JSON.parse`, so a coord that predates
   * the field sends nothing. Absent is NOT enforced — see the consumer's
   * `isEnforced`.
   */
  notification_enforced: boolean;
  /**
   * Coord's own prose statement of what `allow_with_notification` does on the
   * coord that answered.
   *
   * NOT content-free once the precondition is enforced, which is why coord kept
   * the field rather than deleting it with the caveat it used to carry: the
   * enforced text states the positive fact AND the one residual the tier cannot
   * promise away — the subtractive `policy_write` dial, applied after
   * authorization, which can still refuse a write the tier permitted. Render it
   * in both states.
   */
  warning: string;
}

/** `GET /coord/prompt-document-kind-tiers` — one row per kind, as coord projects it. */
export async function fetchKindTiers(): Promise<KindTiersResponse> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-kind-tiers`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<KindTiersResponse>(res, `GET ${url}`);
}

/** `PUT /coord/prompt-document-kind-tiers/:kind` — set one kind's tier. The caller ignores the body. */
export async function putKindTier(
  kind: string,
  tier: AgentWriteTier
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-kind-tiers/${encodeURIComponent(
    kind
  )}`;
  const res = await httpClient.fetch(url, {
    method: "PUT",
    body: JSON.stringify({ tier }),
    idempotent: true,
  });
  return readJson<unknown>(res, `PUT ${url}`, { unparseable: "null" });
}

/** `DELETE /coord/prompt-document-kind-tiers/:kind` — clear one kind's tier (a 204 resolves `null`). */
export async function deleteKindTier(kind: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/prompt-document-kind-tiers/${encodeURIComponent(
    kind
  )}`;
  const res = await httpClient.fetch(url, {
    method: "DELETE",
    idempotent: true,
  });
  return readJson<unknown>(res, `DELETE ${url}`, { unparseable: "null" });
}
