/**
 * ConstraintsAdminOnly: what the constraints UI shows in place of the
 * constraints and their editors when the backend refused the read because the
 * viewer is not a platform admin (`isConstraintsAdminRefusal`).
 *
 * The refusal is an ANSWER, not a failure, so it is never rendered as an empty
 * constraint list or as a load error. It is calm (`INERT`, style guide R3 "the
 * third case"): nothing is broken and nothing clears it by waiting, so the hue
 * claims nothing and the sentence says what the rule is and why. No editor is
 * rendered beside it.
 */

import { INERT } from "@/components/console";
import { CONSTRAINTS_ADMIN_ONLY } from "@/lib/constraints-api";
import { cn } from "@/lib/utils";

export function ConstraintsAdminOnly({
  testId = "constraints-admin-only",
  className,
}: {
  testId?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn("rounded-md border px-3 py-2 text-sm", INERT, className)}
      data-testid={testId}
      data-ui-bridge-id={testId}
    >
      <p className="font-medium text-foreground">{CONSTRAINTS_ADMIN_ONLY}</p>
      <p className="text-xs mt-1">
        A constraint can run a command on the machine that runs the workflow, so
        only a platform administrator can view or change constraints.
      </p>
    </div>
  );
}
