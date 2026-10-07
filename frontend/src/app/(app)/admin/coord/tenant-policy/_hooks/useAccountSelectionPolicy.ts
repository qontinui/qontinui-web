"use client";

import { useTenantFleetPolicyDial } from "../../_shared/useTenantFleetPolicyDial";
import {
  ACCOUNT_SELECTION_DEFAULT_LEVEL,
  ACCOUNT_SELECTION_DOMAIN,
  parseAccountSelectionLevel,
  type AccountSelectionLevel,
} from "../types";

/**
 * The `account_selection_mode` fleet-policy dial
 * (`off` | `manual` | `least_usage` | `highest_expected_usage`).
 *
 * Plan
 * `2026-10-01-fleet-account-selection-effective-mode-visibility-and-pin-safe-saves`
 * Phase 3. A binding of the shared tenant-band dial; the read-back honesty
 * properties live — and are documented — in `useTenantFleetPolicyDial`. It is
 * tenant-band for the reason the runner records: the mode is machine-global,
 * and a machine is not repo-scoped.
 *
 * What is specific to THIS domain, mirroring the runner's
 * `account_selection_outcome_for_body` + `normalize_account_selection_level`:
 *
 * * **No row is `off` — no fleet opinion.** A `resolved_scope: "none"` answer
 *   is "no fleet opinion" whatever level string rides along, so `displayLevel`
 *   is `off` and `isDefaulted` says nobody chose it.
 * * **An unrecognised level is UNKNOWN, never a known level.** A row whose
 *   level is none of the four is not mapped onto any of them: `displayLevel`
 *   is `null` and `unrecognizedLevel` carries the raw string so the UI can
 *   name the row to fix. (Runners built from the plan read such a row as no
 *   fleet opinion, but a runner this console cannot see may differ, so the
 *   console does not claim either.)
 */
export function useAccountSelectionPolicy() {
  const dial = useTenantFleetPolicyDial<AccountSelectionLevel>(
    ACCOUNT_SELECTION_DOMAIN,
    "account selection",
    "runners"
  );
  const { policy } = dial;

  const isDefaulted = policy?.resolved_scope === "none";
  const parsed = policy
    ? parseAccountSelectionLevel(policy.effective_level)
    : null;

  const unrecognizedLevel: string | null =
    policy && !isDefaulted && parsed === null ? policy.effective_level : null;

  const displayLevel: AccountSelectionLevel | null = !policy
    ? null
    : isDefaulted
      ? ACCOUNT_SELECTION_DEFAULT_LEVEL
      : parsed;

  return {
    ...dial,
    /**
     * The level in force: the no-row case resolved to `off`, a recognised row
     * to its level. `null` before the first read AND for an unrecognised row —
     * `unrecognizedLevel` tells the two apart. Prefer this over
     * `policy.effective_level` in the UI.
     */
    displayLevel,
    /** True when no row exists, so `displayLevel` is the no-row `off`. */
    isDefaulted,
    /** The raw served level when it is none of the four known ones. */
    unrecognizedLevel,
  };
}
