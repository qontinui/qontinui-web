"use client";

import { useCallback } from "react";
import { useTenantFleetPolicyDial } from "../../_shared/useTenantFleetPolicyDial";
import { usePageSendGuard } from "./usePageWriteGuardContext";
import {
  isPolicyUpstreamLevel,
  POLICY_UPSTREAM_DOMAIN,
  POLICY_UPSTREAM_FAIL_CLOSED_LEVEL,
  type PolicyUpstreamLevel,
} from "../types";

/**
 * The `policy_upstream` fleet-policy dial — what happens to this tenant when
 * the fleet publishes a new version of a document it holds.
 *
 * Plan `2026-09-04-cross-tenant-policy-publishing` D6.
 *
 * Built on `_shared/useTenantFleetPolicyDial`, which holds the two
 * load-bearing properties below (its 1 and 2) for every dial, for the reasons
 * stated there:
 *
 * 1. **What is displayed is what devices resolve, never what was written.**
 *    Every state transition comes from a READ; the write's own echo is kept
 *    separately (`lastWrite`) so the two can be compared rather than conflated.
 * 2. **A failed read-back is UNKNOWN.** The last known-good value stays on
 *    screen and the error is surfaced. The page pins this dial's requests,
 *    so the shared dial reads the level again at once, pinned, and what is
 *    shown becomes coord's — with the read-back's own warning when that is
 *    not the level written.
 *
 * What is specific to THIS domain:
 *
 * **"No row" is `auto`, and getting that wrong ships the feature dark.** D6
 * spends a warning block on this: an unregistered domain resolves `off` for
 * every tenant, so publications would land and nothing would ever fan out,
 * with no error anywhere. With no row, coord serves the typed default `auto`
 * as `effective_level` while `resolved_scope` stays `"none"`
 * (qontinui-coord#4239; before it, a no-row answer read `"off"` and this
 * console kept its own copy of the default). `isDefaulted` says which case
 * produced the displayed level so the control can label it rather than imply
 * an operator chose it.
 *
 * **An unparseable row is `off`** — the same rule `policy_write` has,
 * sharpened by what this dial authorises: coord writing a body into this
 * tenant from another tenant's publication. An authority setting coord cannot
 * read is not permission to do that. A NO-ROW answer whose level is
 * unparseable is vocabulary skew (coord serving a default this console does
 * not know); coord enforces that default, so it is UNKNOWN here
 * (`defaultUnreadable`), not `off`.
 *
 * **Which project, and when nothing is written.** On the prompt-documents
 * page the read and the write are sent in the page's project, asked as each
 * goes out, and nothing is read before the page knows it: the shared dial
 * reads first then, and says it is waiting until it does. A write is refused
 * — nothing sent, the page says why — while another tab's project switch is
 * in effect, or while the page has no project to pin it to. Both come from
 * the page's provider (`usePageSendGuard`), and the refusal sits here, beside
 * the send, so no caller can leave it out. It is never mounted outside that provider,
 * and throws if it is: there is no unguarded mode.
 */
export function usePolicyUpstreamPolicy() {
  const { writeAllowed, resolvePin } = usePageSendGuard();
  // Read, write and read-back — with the refresh-vs-write race guard and the
  // send-time pin — are the shared tenant-band dial's; this hook adds the
  // page's write guard and the domain's level vocabulary below. The shared
  // dial takes the pin as its optional `resolvePin`: it serves pages with no
  // such provider too, and they pass nothing.
  const dial = useTenantFleetPolicyDial<PolicyUpstreamLevel>(
    POLICY_UPSTREAM_DOMAIN,
    "upstream policy updates",
    "devices resolve",
    { resolvePin }
  );
  const { policy, setLevel: sendLevel } = dial;

  /** `dial.setLevel`, refused while the page's guard says no. */
  const setLevel = useCallback(
    (level: PolicyUpstreamLevel, changeNote?: string): Promise<boolean> =>
      writeAllowed() ? sendLevel(level, changeNote) : Promise.resolve(false),
    [writeAllowed, sendLevel]
  );

  // `"none"` means no row matched, so `effective_level` is coord's served typed
  // default (qontinui-coord#4239) — NOT an operator's choice.
  const isDefaulted = policy?.resolved_scope === "none";

  // The served level is not in the vocabulary. Resolve it the most restrictive
  // way and keep the raw string so the UI can name it, rather than presenting
  // `off` as an operator's choice. It is named on a no-row answer too, which
  // is UNKNOWN rather than `off` (see `defaultUnreadable`).
  const unrecognizedLevel: string | null =
    policy && !isPolicyUpstreamLevel(policy.effective_level)
      ? policy.effective_level
      : null;

  // A no-row answer this console cannot read is UNKNOWN, not `off`: with no
  // row coord enforces its own typed default, which is a real level that only
  // this console's vocabulary is missing (vocabulary skew). Claiming `off`
  // there would be false; a ROW coord cannot parse genuinely fails closed.
  const defaultUnreadable = isDefaulted && unrecognizedLevel !== null;

  // Calls the guard again rather than branching on `unrecognizedLevel`, so the
  // narrowing is TypeScript's own and no cast is needed.
  const displayLevel: PolicyUpstreamLevel | null =
    !policy || defaultUnreadable
      ? null
      : isPolicyUpstreamLevel(policy.effective_level)
        ? policy.effective_level
        : POLICY_UPSTREAM_FAIL_CLOSED_LEVEL;

  return {
    ...dial,
    /** Write `level` at the tenant band — unless the page's guard says no. */
    setLevel,
    /**
     * The level actually in force: coord's served level (its typed default
     * when no row exists), or fail-closed `off` for a row whose level coord
     * cannot parse, the way coord enforces it. One of the three known levels,
     * or `null` before the first read or when `defaultUnreadable`.
     * Prefer this over `policy.effective_level` in the UI.
     */
    displayLevel,
    /** True when no row exists, so the served level is coord's default. */
    isDefaulted,
    /**
     * True when no row exists AND coord's served default is a level this
     * console does not recognise. What coord enforces is then UNKNOWN here,
     * so `displayLevel` is `null` — distinct from "not read yet", which has
     * no `policy`.
     */
    defaultUnreadable,
    /**
     * The raw level string coord served when it is NOT one this console
     * knows — the value, and the row that holds it if there is one — so the
     * UI can name it rather than present `off` as an operator's choice.
     */
    unrecognizedLevel,
  };
}
