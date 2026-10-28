/**
 * AppConfigAdminOnly — what the fleet UI shows in place of the app registry and
 * its editors when the backend refused the read because the viewer is not a
 * platform admin (`isAppConfigAdminRefusal`).
 *
 * The refusal is an ANSWER, not a failure, so it is never rendered as an empty
 * registry ("No registered apps") or as a generic load error. It is calm
 * (`INERT`, style guide R3 "the third case"): nothing is broken and nothing
 * clears it by waiting, so the hue claims nothing and the sentence says what
 * the rule is and why. No edit control is rendered beside it.
 */

import { INERT } from "@/components/console";
import { APP_CONFIG_ADMIN_ONLY } from "@/lib/api/fleet";
import { cn } from "@/lib/utils";

export function AppConfigAdminOnly({
  testId = "fleet-apps-admin-only",
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
      <p className="font-medium text-foreground">{APP_CONFIG_ADMIN_ONLY}</p>
      <p className="text-xs mt-1">
        An app&apos;s update strategy and its build and start commands apply on
        every fleet machine that auto-freshes it, so only a platform
        administrator can view or change them.
      </p>
    </div>
  );
}
