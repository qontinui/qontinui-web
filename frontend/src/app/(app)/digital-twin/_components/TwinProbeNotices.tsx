"use client";

import { AlertTriangle, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { UNKNOWN_AMBER } from "@/components/console";
import { usePresentationMode } from "@/components/presentation";
import { cn } from "@/lib/utils";
import { statusSuffix } from "../_lib/failure-text";
import { RESTRICTED_REASON } from "../_lib/twin-aspects";

/**
 * The two notices every view of the sub-space probe shares (the Completeness
 * matrix and the Lifecycle view read the same `useDigitalTwinSubspaces` data,
 * so they must degrade the same way).
 *
 * In presentation mode (plan `2026-10-23-console-presentation-spaces`) each is
 * a labelled UNKNOWN naming why there is no reading: an outsider must not read
 * an access decision as if it were data about the product, nor be shown a raw
 * transport error.
 */

/** A labelled UNKNOWN, for a reading the page does not have. */
export function UnknownReading({
  reason,
  consequence,
  "data-testid": testId,
}: {
  reason: string;
  /**
   * What the missing reading means for what is on screen, after "so": each
   * caller says it, because it is a claim about the view around the notice
   * — "no live status is shown here" holds only where the notice replaces
   * the view.
   */
  consequence: string;
  "data-testid"?: string;
}) {
  return (
    <div
      data-testid={testId}
      data-reading="unknown"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm"
    >
      <Badge
        variant="outline"
        className={cn("text-[11px] font-semibold", UNKNOWN_AMBER)}
      >
        UNKNOWN
      </Badge>
      <span className="text-muted-foreground">
        {reason.charAt(0).toUpperCase() + reason.slice(1)}, so {consequence}.
      </span>
    </div>
  );
}

/**
 * coord's coarse twin tenant gate denied this operator (home tenant outside
 * the configured internal-tenant allowlist): EVERY probe was refused
 * (`resolve.ts` `allProbesRestricted`). Rendered INSTEAD of the view rather
 * than an all-"error" grid — it's an access decision, not an outage. A single
 * refused sub-space never reaches here; it renders as its own `restricted`
 * cell, so this copy stays true whenever it shows.
 */
export function TwinAccessRestricted() {
  const { presenting } = usePresentationMode();
  if (presenting) {
    return (
      <UnknownReading
        reason={RESTRICTED_REASON}
        // Rendered INSTEAD of the view: nothing live is on screen.
        consequence="no live status is shown here"
        data-testid="digital-twin-access-restricted"
      />
    );
  }
  return (
    <div
      data-testid="digital-twin-access-restricted"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card px-6 py-16 text-center"
    >
      <Lock className="size-8 text-muted-foreground" />
      <h2 className="text-base font-semibold">Access restricted</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        The Digital Twin is limited to internal Qontinui operators. Your tenant
        isn&apos;t on the allowlist for the fleet-wide twin observers — ask an
        administrator if you need access.
      </p>
    </div>
  );
}

/**
 * The probe has no current reading: the request failed, or it answered
 * degraded — HTTP 200 with no probe made (`probeDegradedReason`), its cells
 * stand-ins. The view still renders below it (the manifest, and cells with
 * their last or stand-in status), so the notice says those are not a current
 * reading rather than that nothing live is shown.
 */
export function CoordUnreachableBanner({
  error,
  degraded = null,
}: {
  error: unknown;
  /** Why a degraded answer holds no reading, or `null` (`probeDegradedReason`). */
  degraded?: string | null;
}) {
  const { presenting } = usePresentationMode();
  if (presenting) {
    return (
      <UnknownReading
        reason={
          degraded ??
          `coord's live probe could not be read${statusSuffix(error)}`
        }
        consequence="the live statuses below are not a current reading"
        data-testid="digital-twin-coord-unreachable"
      />
    );
  }
  return (
    <div
      data-testid="digital-twin-coord-unreachable"
      className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
    >
      <AlertTriangle className="size-4 shrink-0" />
      {degraded !== null ? (
        <span>
          {degraded.charAt(0).toUpperCase() + degraded.slice(1)}. The live cells
          below stand in for the probes coord last declared — they are not
          readings; the taxonomy below is still accurate.
        </span>
      ) : (
        <span>
          Could not reach the coordination layer
          {error instanceof Error ? `: ${error.message}` : ""}. Live cells fall
          back to their last status; the taxonomy below is still accurate.
        </span>
      )}
    </div>
  );
}
