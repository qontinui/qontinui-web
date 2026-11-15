"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  fetchFleetPolicy,
  putFleetPolicy,
  type FleetPolicyView,
  type FleetPolicyWriteResult,
} from "@/lib/api/operations/tenantPolicy";
import {
  rereadAfterFailedReadBack,
  resolvedOtherwise,
  type Resolvers,
} from "../../_shared/fleetPolicyReadBack";
import {
  useFirstPinnedRead,
  useSendTimePin,
} from "../../_shared/useSendTimePin";
import { usePageSendGuard } from "./usePageWriteGuardContext";
import { pinForWrite } from "./usePageWriteGuard";
import {
  isPolicyAutoPublishLevel,
  POLICY_AUTO_PUBLISH_DEFAULT_LEVEL,
  POLICY_AUTO_PUBLISH_DOMAIN,
  POLICY_AUTO_PUBLISH_FAIL_CLOSED_LEVEL,
  type PolicyAutoPublishLevel,
} from "../types";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Who resolves this dial's level, for its read-back's warning. */
const RESOLVERS: Resolvers = "the worker resolves";

/**
 * The `policy_auto_publish` fleet-policy dial — whether this tenant's settled
 * document edits publish themselves to the fleet.
 *
 * Plan `2026-09-19-policy-publish-all-and-auto-publish` D5. Modelled on
 * `usePolicyUpstreamPolicy` in this same directory, field for field, and it
 * keeps that hook's two load-bearing properties for the reasons stated there:
 *
 * 1. **What is displayed is what the worker resolves, never what was written.**
 *    Every state transition comes from a READ; the write's own echo is kept
 *    separately (`lastWrite`) so the two can be compared rather than conflated.
 * 2. **A failed read-back is UNKNOWN.** The last known-good value stays on
 *    screen and the error is surfaced, and the level is read again at once,
 *    pinned, so what is shown becomes coord's — saying what a read-back
 *    would: "now X" for the level written, its warning for any other
 *    (`rereadAfterFailedReadBack`).
 *
 * What is specific to THIS domain:
 *
 * **It is the OUTBOUND twin of `policy_upstream`, and the direction is the
 * whole difference.** That dial decides what the fleet may do to this tenant's
 * documents; this one decides whether this tenant's documents reach every other
 * tenant on their own. Both are resolved per tenant by coord's generic
 * resolver, but only the SYSTEM tenant's row governs anything — the worker
 * publishes from the system tenant and nowhere else, so a downstream tenant's
 * row is inert. The control says so rather than implying otherwise.
 *
 * **"No row" is `on`, and getting it wrong ships the feature dark.** Coord
 * answers `effective_level: "off"` both for "nobody ever wrote a row" and for
 * "an operator turned it off". Reading the first literally would mean the
 * worker decides no publish modes, holds nothing and publishes nothing, with no
 * error anywhere — which is indistinguishable from the eight silent days this
 * plan exists to end. `isDefaulted` says which case produced the displayed
 * level so the control can label it rather than imply an operator chose it.
 *
 * **An unparseable level is `off`, not the default.** "Nobody ruled" and
 * "somebody ruled unreadably" are different facts, and the second one is about
 * this tenant's policy bodies reaching the whole fleet with no human in the
 * loop. An authority setting coord cannot read is not permission to do that.
 *
 * **What this dial does NOT switch off:** publish-all, the single-document
 * Publish button, and the auto-publisher's daily recovery reconcile. D5 is
 * explicit that the switch stops the automatic path and not the manual one —
 * gating the recovery reconcile on it would mean turning automatic publishing
 * off silently removed the safety net under the button the operator still
 * presses.
 *
 * **Which project it reads and writes, and when it writes nothing.** On the
 * prompt-documents page the read and the write are sent in the page's
 * project, asked as each goes out and kept on every attempt, so a write
 * re-issued after another tab's switch cannot land in that tab's project.
 * Nothing is read before the page knows its project: the first read goes out
 * then (`useFirstPinnedRead`), and `waitingForProject` says the hook is
 * waiting. A write is refused — nothing sent, the page says why — while that
 * switch is in effect, or while the page has no project to pin it to. Both
 * come from the page's provider (`usePageSendGuard`), and the refusal sits
 * beside the send, which reads the pin it is sent in (`pinForWrite`), so no
 * caller can leave it out. It is never mounted outside that provider, and
 * throws if it is: there is no unguarded mode.
 */
export function usePolicyAutoPublishPolicy() {
  const { writeAllowed, resolvePin } = usePageSendGuard();
  // One identity whatever the provider hands over, so the first read runs once.
  const sendPin = useSendTimePin(resolvePin);
  const [policy, setPolicy] = useState<FleetPolicyView | null>(null);
  // Loading only once a read goes out: not while waiting for a project.
  const [loading, setLoading] = useState(() => sendPin() !== undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastWrite, setLastWrite] = useState<FleetPolicyWriteResult | null>(
    null
  );
  // Bumped when a write LANDS. A read that began before it may answer after
  // the write's own result; applying it would paint the level from before
  // the write. Its answer is dropped, as the shared dial does
  // (`useTenantFleetPolicyDial`).
  const writeGeneration = useRef(0);

  /**
   * Read the level: the view when THIS read landed and is now what is shown,
   * else `null` — it failed, sent nothing, or a write landed while it was in
   * flight and it was discarded.
   */
  const read = useCallback(async (): Promise<FleetPolicyView | null> => {
    const pin = sendPin();
    // No project to read in yet: nothing is sent, and what is shown stays.
    if (pin === undefined) return null;
    const generation = writeGeneration.current;
    try {
      setLoading(true);
      const view = await fetchFleetPolicy(
        POLICY_AUTO_PUBLISH_DOMAIN,
        undefined,
        pin
      );
      if (generation !== writeGeneration.current) return null;
      setPolicy(view);
      setError(null);
      // A confirmed read retires the previous write's read-back failure — its
      // banner says "the value above may be stale", and leaving it up beside a
      // value we just confirmed would be the opposite of honest.
      setLastWrite(null);
      return view;
    } catch (err) {
      if (generation !== writeGeneration.current) return null;
      // Keep the last known-good value on screen; the banner says it is stale.
      // Blanking it would read as "off", which is a claim we cannot make.
      setError(message(err, "Failed to read the automatic-publishing dial"));
      return null;
    } finally {
      setLoading(false);
    }
  }, [sendPin]);

  const load = useCallback(async (): Promise<void> => {
    await read();
  }, [read]);

  const waitingForProject = useFirstPinnedRead(sendPin, () => void load());

  /**
   * Write `level` at the tenant band.
   *
   * `master_enabled` stays `true` and `off` is expressed as a LEVEL, for the
   * reason every sibling dial gives: coord resolves `effective_level = off`
   * whenever the master is false, so also flipping the master would give "off"
   * two spellings with no way for the operator to tell which is in force.
   */
  const setLevel = useCallback(
    async (
      level: PolicyAutoPublishLevel,
      changeNote?: string
    ): Promise<boolean> => {
      const pin = pinForWrite(writeAllowed, sendPin);
      if (pin === undefined) return false;
      try {
        setSaving(true);
        const result = await putFleetPolicy(
          {
            domain: POLICY_AUTO_PUBLISH_DOMAIN,
            scope_band: "tenant",
            scope_key: null,
            level,
            master_enabled: true,
            change_note:
              changeNote ??
              `Set automatic publishing to "${level}" from the console`,
          },
          pin
        );
        writeGeneration.current += 1;
        setLastWrite(result);
        const confirmed = `Automatic publishing is now "${level}".`;

        if (result.effective) {
          setPolicy(result.effective);
          setError(null);
          if (result.effective.effective_level === level) {
            toast.success(confirmed);
          } else {
            // A write that landed and a value that resolves are different
            // facts. Say which one the worker is actually on.
            toast.warning(
              resolvedOtherwise(level, RESOLVERS, result.effective)
            );
          }
        } else {
          toast.warning(
            "The write went through, but the read-back failed — what this " +
              "tenant resolves is unknown until this refreshes."
          );
          // Read it again, pinned, so what is shown is coord's level and not
          // the one from before the write, and say what the read-back would
          // have. A failed re-read keeps both the value and the warning.
          void rereadAfterFailedReadBack({
            read,
            level,
            confirmed,
            resolvers: RESOLVERS,
            onError: (err) =>
              setError(
                message(err, "Failed to read the automatic-publishing dial")
              ),
          });
        }
        return true;
      } catch (err) {
        toast.error(
          message(err, "Failed to write the automatic-publishing dial")
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [read, sendPin, writeAllowed]
  );

  // `"none"` means no row matched, which for this domain is `on` — NOT off.
  // Mirrors coord's `resolve_policy_auto_publish_level`; if the two ever
  // disagree the console misreports the fleet.
  const isDefaulted = policy?.resolved_scope === "none";

  // A row exists but its level is not in the vocabulary. Resolve it the most
  // restrictive way and keep the raw string so the UI can name the row to fix,
  // rather than presenting `off` as an operator's choice.
  const unrecognizedLevel: string | null =
    policy && !isDefaulted && !isPolicyAutoPublishLevel(policy.effective_level)
      ? policy.effective_level
      : null;

  // Calls the guard again rather than branching on `unrecognizedLevel`, so the
  // narrowing is TypeScript's own and no cast is needed.
  const displayLevel: PolicyAutoPublishLevel | null = !policy
    ? null
    : isDefaulted
      ? POLICY_AUTO_PUBLISH_DEFAULT_LEVEL
      : isPolicyAutoPublishLevel(policy.effective_level)
        ? policy.effective_level
        : POLICY_AUTO_PUBLISH_FAIL_CLOSED_LEVEL;

  return {
    policy,
    loading,
    saving,
    error,
    /** No project to read in yet: nothing has been read, or is shown as read. */
    waitingForProject,
    /**
     * The level actually in force: the no-row case resolved to coord's typed
     * default, an unparseable row resolved fail-closed. Always one of the two
     * known levels, or `null` before the first read. Prefer this over
     * `policy.effective_level` in the UI.
     */
    displayLevel,
    /** True when no row exists, so `displayLevel` is coord's typed default. */
    isDefaulted,
    /**
     * The raw level string coord returned when it is NOT one this console
     * knows. `displayLevel` has already been resolved fail-closed; this exists
     * so the UI can name the row that needs fixing.
     */
    unrecognizedLevel,
    /** Set only when the last write's read-back failed. UNKNOWN, not "off". */
    readbackError: lastWrite?.readback_error ?? null,
    lastWrite,
    reload: load,
    setLevel,
  };
}
