"use client";

/**
 * The last-host question (plan §D4), asked the same way wherever a CI pause
 * can hit coord's `last_matching_host` refusal — the Prepare dialog and the
 * CI lever's re-hold. The consequence is stated locally, in the plan's words,
 * above coord's own message; the button resends the refused request with
 * `accept_ci_queueing: true` and nothing else.
 */

import { Button } from "@/components/ui/button";
import type { MaintenanceError } from "@/components/operations/maintenanceWindow";

export function LastHostNotice({
  refusal,
  until,
  busy,
  onAccept,
  testIdPrefix,
}: {
  refusal: MaintenanceError;
  /** The deadline as the operator reads it, e.g. `18:00`. */
  until: string;
  busy: boolean;
  onAccept: () => void;
  testIdPrefix: string;
}) {
  return (
    <div
      role="alert"
      className="space-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2"
      data-testid={`${testIdPrefix}-last-host`}
    >
      <p
        className="text-xs break-words"
        data-testid={`${testIdPrefix}-last-host-consequence`}
      >
        This is the last host that runs{" "}
        {refusal.poolKey ? (
          <code className="font-mono break-all">[{refusal.poolKey}]</code>
        ) : (
          "the fleet's CI routing labels"
        )}
        . CI jobs will queue at GitHub until {until} or until you return the
        machine to service.
      </p>
      <p className="text-[11px] text-muted-foreground break-words">
        Coord: {refusal.message}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={onAccept}
        data-testid={`${testIdPrefix}-accept-queueing`}
      >
        Pause anyway — CI will queue at GitHub until {until}
      </Button>
    </div>
  );
}
