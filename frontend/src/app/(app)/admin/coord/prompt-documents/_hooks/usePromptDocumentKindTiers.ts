"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import type { AgentWriteTier } from "../types";

const API = "/api/v1/operations/coord/prompt-document-kind-tiers";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

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

/**
 * The per-KIND agent authorship tier — the operator's control over whether
 * agents may author documents of a given kind, including names that do not
 * exist yet.
 *
 * ## Why this exists beside the per-document control
 *
 * `AgentWriteAccessControl` sets `agent_write_tier` on a document ROW, so it
 * can only be pointed at a document that already exists. The intent kinds
 * (`product_intent`, `initiative`, `success_metric`, `domain_spec`,
 * `audience_profile`, `decision_record`) are denied kind-wide over an OPEN name
 * space: an agent's first write to a NEW name is refused, and there is nothing
 * to flip, because the row the flip would live on is the row the refused write
 * would have created. This is the only setting that can be expressed before the
 * document exists.
 *
 * ## Two properties carried over from `usePolicyWritePolicy`
 *
 * 1. **What is displayed comes from a READ, never from the write's echo.** A
 *    successful PUT does not entail what enforcement resolves — the floor sits
 *    above every stored tier — so every state transition here reloads.
 * 2. **A failed read is UNKNOWN, not empty.** Coord answers 503 rather than an
 *    empty list when the store is unprovisioned, exactly so this console cannot
 *    render "no kind has a setting" as though somebody had checked. The error
 *    is surfaced and the last known-good rows stay on screen.
 *
 * ## The disclosure is not optional
 *
 * Coord treats `allow_with_notification` exactly as `allow` today: the tier
 * resolves, the notification precondition is not enforced. `notification_enforced`
 * and `warning` come back on every response for that reason, and the UI must
 * show them. A control whose NAME promises more than the deployed build
 * delivers — in the permissive direction — is worse than no control.
 */
export function usePromptDocumentKindTiers() {
  const [data, setData] = useState<KindTiersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Returns whether the read SUCCEEDED. `setTier`/`clearTier` need that answer:
  // this function swallows its own failure by design (the last known-good rows
  // stay on screen), so `await load()` returning normally is not evidence the
  // displayed state is current — and a success toast raised through a failed
  // read-back is the write's echo wearing a read's clothes.
  const load = useCallback(async (): Promise<boolean> => {
    try {
      setLoading(true);
      const view = await httpClient.get<KindTiersResponse>(API);
      setData(view);
      setError(null);
      return true;
    } catch (err) {
      // Keep the last known-good rows on screen. Blanking them would read as
      // "no kind has a setting", which is a claim about the operator's
      // configuration that a failed read is no evidence for.
      setError(message(err, "Failed to read the per-kind authorship tiers"));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Set one kind's tier, then RELOAD.
   *
   * The reload is the point, not politeness: coord's floor pre-empts every
   * stored tier, so painting the written value would be the display path
   * asserting an authority decision the resolver may not agree with. The floor
   * is refused with a 409 rather than stored, so that disagreement should be
   * impossible — and "should be impossible" is exactly the class of claim this
   * console is not allowed to make on its own.
   */
  const setTier = useCallback(
    async (kind: string, tier: AgentWriteTier): Promise<boolean> => {
      try {
        setSaving(true);
        await httpClient.put(`${API}/${encodeURIComponent(kind)}`, { tier });
        const confirmed = await load();
        // `deny` goes through this same function, so one message for all three
        // tiers said "Agents may now write ... : deny" — the display asserting
        // the opposite of what the operator just did, in the permissive
        // direction.
        const what =
          tier === "deny"
            ? `Agents may no longer write \`${kind}\` documents.`
            : `Agents may now write \`${kind}\` documents: "${tier}".`;
        if (confirmed) {
          toast.success(what);
        } else {
          // The write went through; what coord now resolves is UNKNOWN.
          toast.warning(
            `${what} The read-back failed, so what coord resolves for ` +
              `\`${kind}\` is unconfirmed until this refreshes.`
          );
        }
        return true;
      } catch (err) {
        toast.error(message(err, `Failed to set the tier for \`${kind}\``));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [load]
  );

  /** Clear one kind's tier, returning it to coord's compile-time default. */
  const clearTier = useCallback(
    async (kind: string): Promise<boolean> => {
      try {
        setSaving(true);
        await httpClient.delete(`${API}/${encodeURIComponent(kind)}`);
        const confirmed = await load();
        const what =
          `Cleared the tenant setting for \`${kind}\` — coord's built-in ` +
          `default applies again.`;
        if (confirmed) {
          toast.success(what);
        } else {
          toast.warning(
            `${what} The read-back failed, so what coord resolves for ` +
              `\`${kind}\` is unconfirmed until this refreshes.`
          );
        }
        return true;
      } catch (err) {
        toast.error(message(err, `Failed to clear the tier for \`${kind}\``));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [load]
  );

  return {
    /** `null` until the first read succeeds. Never an invented empty list. */
    data,
    loading,
    saving,
    error,
    reload: load,
    setTier,
    clearTier,
  };
}
