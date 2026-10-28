/**
 * ConstraintsReadNote: the label a constraints surface shows when its read
 * cannot support what the surface would otherwise say.
 *
 * It goes in place of the constraint lists AND their empty sentences when no
 * read ever delivered (UNKNOWN: "no constraints" would be a confident
 * default). It goes above the lists when they come from an earlier read that a
 * newer one failed to refresh (STALE: the lists are real, only old). Either way
 * it names the failure.
 *
 * Amber (`UNKNOWN_AMBER`, the console's ignorance floor, style guide R3): a
 * statement about what this surface knows. Not calm, because nothing says the
 * constraints are fine; not the red of a fault, because no one is known to
 * have to act. The same vocabulary as `/settings/fleet`'s read notes.
 */

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { UNKNOWN_AMBER } from "@/components/console";
import { cn } from "@/lib/utils";

export function ConstraintsReadNote({
  reason,
  testId,
  children,
}: {
  /** Why the read failed, in the failed call's own words. */
  reason: string | null;
  testId: string;
  /** What is unknown or stale, and what that means for the surface. */
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        UNKNOWN_AMBER
      )}
      data-testid={testId}
      data-ui-bridge-id={testId}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p>{children}</p>
        {reason !== null && <p className="mt-1">Reason: {reason}</p>}
      </div>
    </div>
  );
}
