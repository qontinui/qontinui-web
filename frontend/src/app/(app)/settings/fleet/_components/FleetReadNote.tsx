/**
 * FleetReadNote: the label a `/settings/fleet` section shows when its read
 * cannot support what the section would otherwise say.
 *
 * It goes in place of the section's rows AND its empty sentence when no read
 * ever delivered (UNKNOWN: "none yet" would be a confident default). It goes
 * above the rows when they come from an earlier read that a newer one failed
 * to refresh (STALE: the rows are real, only old). Either way it names the
 * failure.
 *
 * Amber (`UNKNOWN_AMBER`, the console's ignorance floor, style guide R3): it is
 * a statement about what this page knows. It is not calm, because nothing says
 * the section is fine. It is not the red of a fault, because no one is known to
 * have to act.
 */

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { UNKNOWN_AMBER } from "@/components/console";
import { cn } from "@/lib/utils";

export function FleetReadNote({
  reason,
  testId,
  children,
}: {
  /** Why the read failed, in the failed call's own words. */
  reason: string | null;
  testId: string;
  /** What is unknown or stale, and what that means for the section. */
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        UNKNOWN_AMBER
      )}
      data-testid={testId}
      data-ui-bridge-id={testId}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p>{children}</p>
        {reason !== null && <p className="mt-1 text-xs">Reason: {reason}</p>}
      </div>
    </div>
  );
}
