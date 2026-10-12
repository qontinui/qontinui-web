"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  clearKindTier,
  fetchKindTiers,
  setKindTier,
  type KindTiersResponse,
} from "@/lib/api/operations/coordPromptDocuments";
import type { AgentWriteTier } from "../types";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
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
      const view = await fetchKindTiers();
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
        await setKindTier(kind, tier);
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
        await clearKindTier(kind);
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
