"use client";

import { useCallback } from "react";
import { useTenantFleetPolicyDial } from "../../_shared/useTenantFleetPolicyDial";
import { usePageSendGuard } from "./usePageWriteGuardContext";
import {
  isPolicyWriteLevel,
  POLICY_WRITE_DOMAIN,
  POLICY_WRITE_FAIL_CLOSED_LEVEL,
  type PolicyWriteLevel,
} from "../types";

/**
 * The `policy_write` fleet-policy dial — how much of the agent policy-write
 * surface this tenant permits.
 *
 * Plan `2026-08-06-agent-policy-replace-and-write-autonomy-dial` §4.
 *
 * Built on `_shared/useTenantFleetPolicyDial`, which holds properties 1 and 2
 * below for every dial (plus tenant-band writes and the refresh-vs-write race
 * guard):
 *
 * 1. **What is displayed is what devices resolve, never what was written.**
 *    Coord folds `master_enabled` in and lets a more specific scope band win, so
 *    a successful write does not entail the value the fleet sees. Every state
 *    transition here comes from a READ; the write's own echo is kept separately
 *    (`lastWrite`) so the two can be compared rather than conflated.
 *
 * 2. **A failed read-back is UNKNOWN.** On `readback_error` the last known-good
 *    value stays on screen and the error is surfaced. Painting the written level
 *    on an unconfirmed write is how a dial starts lying about the fleet. The
 *    page pins this dial's requests, so the shared dial reads the level again
 *    at once, pinned, and what is shown becomes coord's — with the read-back's
 *    own warning when that is not the level written.
 *
 * Three things are specific to THIS domain:
 *
 * **`"none"` does not mean `off`.** With no row, coord serves the domain's
 * typed default (`tightening_only` — today's shipped behaviour) as
 * `effective_level`, while `resolved_scope` stays `"none"`
 * (qontinui-coord#4239; before it, a no-row answer read `"off"` and this
 * console kept its own copy of the default to paper over it). A disabled row
 * genuinely means off.
 * [`displayLevel`] therefore reads the served level directly, and `isDefaulted`
 * says which case it is so the UI can label it rather than imply an operator
 * chose it.
 *
 * **An unparseable row is `off`, not the default.** `level` is free text on
 * every layer, so a hand-written or typo'd row reaches this hook verbatim: the
 * generic fleet-policy GET is domain-agnostic and does not parse it, while
 * coord's enforcement path runs `parse_fail_closed` and refuses everything.
 * [`displayLevel`] therefore resolves an unrecognized string the way the fleet
 * resolves it, and [`unrecognizedLevel`] carries the raw value so the UI can
 * say which row to fix rather than presenting `off` as an operator's choice.
 * A NO-ROW answer whose level is unparseable is vocabulary skew — coord
 * serving a default this console does not know — and coord enforces that
 * default, so it is UNKNOWN here ([`defaultUnreadable`], `displayLevel`
 * `null`), never `off` and never a guessed default.
 *
 * **The dial is subtractive.** It never grants authority — the per-document
 * `agent_write_tier` control decides whether an agent may write a document at all,
 * and this dial can only narrow what happens to a write that control already
 * allowed. That is why this hook lives beside `AgentWriteAccessControl` rather
 * than on a settings page: they are two halves of one question, and the answer
 * is the more restrictive of them.
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
export function usePolicyWritePolicy() {
  const { writeAllowed, resolvePin } = usePageSendGuard();
  // Read, write and read-back — with the refresh-vs-write race guard and the
  // send-time pin — are the shared tenant-band dial's; this hook adds the
  // page's write guard and the domain's level vocabulary below. The shared
  // dial takes the pin as its optional `resolvePin`: it serves pages with no
  // such provider too, and they pass nothing.
  const dial = useTenantFleetPolicyDial<PolicyWriteLevel>(
    POLICY_WRITE_DOMAIN,
    "agent policy-write autonomy",
    "devices resolve",
    { resolvePin }
  );
  const { policy, setLevel: sendLevel } = dial;

  /** `dial.setLevel`, refused while the page's guard says no. */
  const setLevel = useCallback(
    (level: PolicyWriteLevel, changeNote?: string): Promise<boolean> =>
      writeAllowed() ? sendLevel(level, changeNote) : Promise.resolve(false),
    [writeAllowed, sendLevel]
  );

  // `"none"` means no row matched, so `effective_level` is coord's served typed
  // default (qontinui-coord#4239) — NOT an operator's choice.
  const isDefaulted = policy?.resolved_scope === "none";

  // The served level is not in the vocabulary. Coord's GET is domain-agnostic
  // and hands back the raw stored string, while coord's ENFORCEMENT path runs
  // `parse_fail_closed` and resolves the same string to `off`. Rendering the
  // raw value here would show a typo'd row as the level in force while agents
  // are in fact being refused outright — so this keeps the raw string to say
  // WHY. It is named on a no-row answer too (see `defaultUnreadable`).
  const unrecognizedLevel: string | null =
    policy && !isPolicyWriteLevel(policy.effective_level)
      ? policy.effective_level
      : null;

  // A no-row answer this console cannot read is UNKNOWN, not `off`: with no
  // row coord enforces its own typed default, which is a real level that only
  // this console's vocabulary is missing (vocabulary skew). Claiming `off`
  // there would be false; a ROW coord cannot parse genuinely fails closed.
  const defaultUnreadable = isDefaulted && unrecognizedLevel !== null;

  // Calls the guard again rather than branching on `unrecognizedLevel`, so the
  // narrowing is TypeScript's own and no cast is needed to reach a
  // `PolicyWriteLevel`. A cast here would be checked by nothing.
  const displayLevel: PolicyWriteLevel | null =
    !policy || defaultUnreadable
      ? null
      : isPolicyWriteLevel(policy.effective_level)
        ? policy.effective_level
        : POLICY_WRITE_FAIL_CLOSED_LEVEL;

  return {
    ...dial,
    /** Write `level` at the tenant band — unless the page's guard says no. */
    setLevel,
    /**
     * The level actually in force: coord's served level (its typed default
     * when no row exists), or fail-closed `off` for a row whose level coord
     * cannot parse, the way coord enforces it. One of the four known levels,
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
