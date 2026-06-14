"use client";

import { useEffect, useState } from "react";
import { getService } from "@/lib/extension-slots";
import { AutoResponseRulesPanel } from "./_components/AutoResponseRulesPanel";

/**
 * Organizations are a cloud-control-only extension slot. In the base/OSS
 * deployment (and the Spec CI crawl) `organizationService` is not registered,
 * so driving org-scoped calls throws — render a notice instead of mounting the
 * org-backed panel. See `services/service-factory.ts` (`cloudOnlySlot`).
 */
function organizationServiceAvailable(): boolean {
  return getService("organizationService") !== undefined;
}

export default function AutoResponseRulesPage() {
  // Re-check after mount in case cloud-control's `registerCloudExtensions`
  // lands just after first paint (the slot only ever goes unavailable→ready).
  const [available, setAvailable] = useState<boolean>(
    organizationServiceAvailable,
  );
  useEffect(() => {
    if (!available && organizationServiceAvailable()) setAvailable(true);
  }, [available]);

  if (!available) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-lg font-semibold">Auto-Response Rules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Fleet-wide rules that auto-respond to matching agent output.
          </p>
        </div>
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Auto-response rules are managed per organization and are only
            available in the cloud deployment.
          </p>
        </div>
      </div>
    );
  }

  return <AutoResponseRulesPanel />;
}
