/**
 * DriftAdminOnly: what the drift pages show in place of a report or an entry
 * when the backend refused the read because the viewer is not a platform admin
 * (`isDriftAdminRefusal`).
 *
 * The refusal is an ANSWER, not a failure, so it is never rendered as an empty
 * report or as a load error. It is calm (`INERT`, style guide R3 "the third
 * case"): nothing is broken and nothing clears it by waiting, so the hue claims
 * nothing and the sentence says what the rule is and why.
 */

import { INERT } from "@/components/console";
import { cn } from "@/lib/utils";
import { DRIFT_ADMIN_ONLY } from "./drift-api";

export function DriftAdminOnly({
  testId = "drift-admin-only",
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
      <p className="font-medium text-foreground">{DRIFT_ADMIN_ONLY}</p>
      <p className="text-xs mt-1">
        A drift report is read from the runner on this server&apos;s own host,
        which is not tied to your account, so only a platform administrator can
        view it.
      </p>
    </div>
  );
}
