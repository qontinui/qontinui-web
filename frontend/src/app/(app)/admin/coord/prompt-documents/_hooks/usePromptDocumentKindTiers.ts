"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  clearKindTier,
  fetchKindTiers,
  setKindTier,
  type KindTiersResponse,
} from "@/lib/api/operations/coordPromptDocuments";
import {
  useFirstPinnedRead,
  useSendTimePin,
} from "../../_shared/useSendTimePin";
import { usePageSendGuard } from "./usePageWriteGuardContext";
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
 *
 * ## Which project it reads and writes, and when it writes nothing
 *
 * On the prompt-documents page it reads the page's guard and pin from the
 * page's provider (`usePageSendGuard`). Every read — the read-back after each
 * write included — and every write is sent in the page's project, asked as
 * each goes out and kept on every attempt, so a tier write re-issued after
 * another tab's switch cannot open or close a kind in that tab's project, and
 * its read-back cannot show that project's tiers as this one's. Nothing is
 * read before the page knows its project: the first read goes out then
 * (`useFirstPinnedRead`), and `waitingForProject` says the hook is waiting.
 * And a write is refused — nothing sent, the page says why — while another
 * tab's switch is in effect, or while the page has no project to pin it to:
 * the check sits beside the send, so no caller can leave it out. It is never
 * mounted outside the page's provider, and throws if it is: there is no
 * unguarded mode.
 */
export function usePromptDocumentKindTiers() {
  const { writeAllowed, resolvePin } = usePageSendGuard();
  // One identity whatever the provider hands over, so the first read runs once.
  const sendPin = useSendTimePin(resolvePin);
  const [data, setData] = useState<KindTiersResponse | null>(null);
  // Loading only once a read goes out: not while waiting for a project.
  const [loading, setLoading] = useState(() => sendPin() !== undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped when a write LANDS. A read that began before it may answer after
  // the write's own read-back; applying it would paint the tiers as they were
  // before the write. Its answer is dropped, as the shared dial does
  // (`useTenantFleetPolicyDial`).
  const writeGeneration = useRef(0);

  // Returns whether the read SUCCEEDED. `setTier`/`clearTier` need that answer:
  // this function swallows its own failure by design (the last known-good rows
  // stay on screen), so `await load()` returning normally is not evidence the
  // displayed state is current — and a success toast raised through a failed
  // read-back is the write's echo wearing a read's clothes.
  const load = useCallback(async (): Promise<boolean> => {
    const pin = sendPin();
    // No project to read in yet: nothing is sent, and what is shown stays.
    if (pin === undefined) return false;
    const generation = writeGeneration.current;
    try {
      setLoading(true);
      const view = await fetchKindTiers(pin);
      // A write landed since: not what is shown, so not a success.
      if (generation !== writeGeneration.current) return false;
      setData(view);
      setError(null);
      return true;
    } catch (err) {
      if (generation !== writeGeneration.current) return false;
      // Keep the last known-good rows on screen. Blanking them would read as
      // "no kind has a setting", which is a claim about the operator's
      // configuration that a failed read is no evidence for.
      setError(message(err, "Failed to read the per-kind authorship tiers"));
      return false;
    } finally {
      setLoading(false);
    }
  }, [sendPin]);

  const waitingForProject = useFirstPinnedRead(sendPin, () => void load());

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
      if (!writeAllowed()) return false;
      try {
        setSaving(true);
        await setKindTier(kind, tier, sendPin());
        writeGeneration.current += 1;
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
    [load, sendPin, writeAllowed]
  );

  /** Clear one kind's tier, returning it to coord's compile-time default. */
  const clearTier = useCallback(
    async (kind: string): Promise<boolean> => {
      if (!writeAllowed()) return false;
      try {
        setSaving(true);
        await clearKindTier(kind, sendPin());
        writeGeneration.current += 1;
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
    [load, sendPin, writeAllowed]
  );

  return {
    /** `null` until the first read succeeds. Never an invented empty list. */
    data,
    loading,
    saving,
    error,
    /** No project to read in yet: nothing has been read, or is shown as read. */
    waitingForProject,
    reload: load,
    setTier,
    clearTier,
  };
}
