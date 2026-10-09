"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAccountSelectionPolicy } from "../_hooks/useAccountSelectionPolicy";
import { ACCOUNT_SELECTION_LEVELS, type AccountSelectionLevel } from "../types";

const LEVEL_COPY: Record<
  AccountSelectionLevel,
  { label: string; blurb: string }
> = {
  off: {
    label: "No fleet opinion",
    blurb:
      "No fleet opinion: each runner uses the account-selection mode set on that machine.",
  },
  manual: {
    label: "Manual",
    blurb:
      "Every unpinned runner uses the one Claude account configured on that machine, with no automatic switching between accounts. A machine with no account configured cannot start sessions until one is set there or the machine is pinned.",
  },
  least_usage: {
    label: "Least usage",
    blurb:
      "Every unpinned runner picks the Claude account with the lowest usage relative to its expected pace.",
  },
  highest_expected_usage: {
    label: "Highest expected usage",
    blurb:
      "Every unpinned runner picks, among the accounts still under their expected pace, the one expected to use the most. A machine with fewer than two accounts is unaffected.",
  },
};

/**
 * The `account_selection_mode` fleet dial (plan
 * `2026-10-01-fleet-account-selection-effective-mode-visibility-and-pin-safe-saves`
 * Phase 3).
 *
 * Laid out exactly as `CommandSafetyRewritePanel` beside it. What is shown is
 * the level coord RESOLVES, never the level last written
 * (`useTenantFleetPolicyDial` property 1). The states kept apart:
 *
 * * no row (`isDefaulted`) — `off`, no fleet opinion, and nobody chose it.
 * * an unrecognised level — UNKNOWN, named, never mapped onto a known button.
 * * a `repo` band winning / a `system` band answering — the same
 *   most-specific-wins notes as the other dials.
 * * a failed read, or a failed read-back after a write — UNKNOWN.
 *
 * The header copy carries the two limits on "force-applied": a pinned machine
 * keeps its own mode, and a runner predating fleet account selection ignores
 * the value altogether.
 */
export function AccountSelectionPanel() {
  /** Which level's write is in flight, so only that button spins. */
  const [pending, setPending] = useState<AccountSelectionLevel | null>(null);
  const {
    policy,
    loading,
    saving,
    error,
    readbackError,
    lastWrite,
    reload,
    setLevel,
    displayLevel,
    isDefaulted,
    unrecognizedLevel,
  } = useAccountSelectionPolicy();

  const canEdit = policy?.can_edit === true;
  const overriddenByRepo = policy?.resolved_scope === "repo";
  const fallingBackToSystem = policy?.resolved_scope === "system";

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="account-selection-policy"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Users className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">Claude account selection</h2>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              How runners choose which Claude account a session uses when a
              machine has more than one. The mode chosen here is force-applied
              to every runner in this tenant, replacing the mode set on each
              machine.
            </p>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Two exceptions: a machine whose operator pinned its local mode
              keeps its own mode, and runners that predate fleet account
              selection ignore this value. <em>No fleet opinion</em> means each
              runner uses its local setting.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={reload}
          disabled={loading}
          data-testid="account-selection-refresh"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {loading && !policy ? (
        <Skeleton className="mt-4 h-16 w-full" />
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {ACCOUNT_SELECTION_LEVELS.map((level) => (
              <Button
                key={level}
                size="sm"
                variant={displayLevel === level ? "default" : "outline"}
                disabled={saving || !canEdit}
                onClick={() => {
                  setPending(level);
                  setLevel(level).finally(() => setPending(null));
                }}
                data-testid={`account-selection-${level}`}
              >
                {/* Only the level being written spins. */}
                {saving && pending === level && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                {LEVEL_COPY[level].label}
              </Button>
            ))}
            <div className="ml-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>Runners resolve</span>
              <Badge
                variant={
                  displayLevel !== null && displayLevel !== "off"
                    ? "default"
                    : "outline"
                }
                data-testid="account-selection-effective"
                data-level={displayLevel ?? "unknown"}
              >
                {displayLevel === null
                  ? "unknown"
                  : LEVEL_COPY[displayLevel].label}
              </Badge>
              <span>from the</span>
              <Badge variant="outline" data-testid="account-selection-scope">
                {policy?.resolved_scope ?? "unknown"}
              </Badge>
              <span>scope band.</span>
            </div>
          </div>

          {!canEdit && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="account-selection-readonly"
            >
              {policy
                ? "Read-only: you are not an admin of this tenant, so coord would refuse the write (admin_required)."
                : "Read-only: your role could not be read, so whether the write would be accepted is unknown. Refresh once coord answers."}
            </p>
          )}

          {/* The backend fills a band coord did not report with `none`, and
              that is indistinguishable here from a real no-row answer — so
              this copy says what the read returned rather than asserting what
              runners do. */}
          {isDefaulted && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="account-selection-no-row"
            >
              No policy row answered for this tenant, so nobody chose this. This
              console reads that as no fleet opinion (each runner uses its local
              setting), which is also what it shows when coord reports no band
              at all. Pick a mode to write an explicit row.
            </p>
          )}

          {unrecognizedLevel !== null && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="account-selection-unrecognized"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                The resolved level is <code>{unrecognizedLevel}</code>, which is
                not one of the modes above, so what runners do with it is
                unknown. Pick a mode to replace the row.
              </p>
            </div>
          )}

          {overriddenByRepo && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="account-selection-overridden-by-repo"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                A <strong>repo</strong>-band row is winning. Coord resolves the
                most specific band first, so writing here changes the tenant row
                but the repo row will keep overriding it.
              </p>
            </div>
          )}

          {fallingBackToSystem && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="account-selection-system-fallback"
            >
              A fleet-wide <strong>system</strong>-band row is answering because
              this tenant has none of its own. Coord resolves the most specific
              band first, so writing here takes effect immediately.
            </p>
          )}

          {readbackError && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="account-selection-readback-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                The write to <code>{lastWrite?.written_level}</code> was
                accepted, but reading back what runners resolve failed (
                {readbackError}). The value above is the last one confirmed and
                may be stale. Refresh to re-check.
              </p>
            </div>
          )}

          {error && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="account-selection-error"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Couldn&apos;t read the account selection setting: {error}.{" "}
                {policy
                  ? "Showing the last value read, which may be out of date."
                  : "The current value is unknown."}
              </p>
            </div>
          )}

          {/* Coord returns `fleet_resources` blocks with any domain's read; the
              backend strips them and this line says so. */}
          {policy != null && policy.keys_not_shown.length > 0 && (
            <p
              className="text-[11px] text-muted-foreground"
              data-testid="account-selection-keys-not-shown"
            >
              Coord also returned {policy.keys_not_shown.join(", ")} with this
              read.{" "}
              {policy.keys_not_shown_source === "fleet_resources_row"
                ? "Those belong to the fleet_resources row, not to this setting, and are not shown here."
                : "Those are not shown here."}
            </p>
          )}

          {/* `displayLevel === null` is a failed read or an unrecognised
              level — UNKNOWN either way, never `off`. */}
          <p
            className="text-xs text-muted-foreground"
            data-testid="account-selection-blurb"
          >
            {displayLevel !== null
              ? LEVEL_COPY[displayLevel].blurb
              : unrecognizedLevel !== null
                ? "The resolved mode is not one this console recognises, so how runners choose an account is unknown."
                : "The resolved mode could not be read, so how runners choose an account is unknown."}
          </p>
        </div>
      )}
    </section>
  );
}
